package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestInstallIdempotentAndOwnership(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS installer runtime test")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := install(); err != nil {
		t.Fatal(err)
	}
	if err := install(); err != nil {
		t.Fatal("repeat install", err)
	}
	manifest := filepath.Join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts", hostName+".json")
	var data map[string]any
	raw, _ := os.ReadFile(manifest)
	if json.Unmarshal(raw, &data) != nil || data["name"] != hostName {
		t.Fatal("invalid registration")
	}
	allowed := data["allowed_extensions"].([]any)
	if len(allowed) != 1 || allowed[0] != extensionID {
		t.Fatal("incorrect allowed extension")
	}
	other := []byte(`{"name":"other","path":"/other"}`)
	os.WriteFile(manifest, other, 0600)
	if err := install(); err == nil {
		t.Fatal("overwrote a foreign registration")
	}
	got, _ := os.ReadFile(manifest)
	if !bytes.Equal(got, other) {
		t.Fatal("foreign registration changed")
	}
}

func saveTest(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	w := Writer{}
	defer w.abort()
	if _, e := w.handle(Request{Action: "begin", Filename: name, Size: int64(len(data)), Target: Target{Mode: "absolute", Path: dir}}); e != nil {
		t.Fatal(e)
	}
	for p := 0; p < len(data); p += 192 * 1024 {
		end := p + 192*1024
		if end > len(data) {
			end = len(data)
		}
		if _, e := w.handle(Request{Action: "chunk", Data: base64.StdEncoding.EncodeToString(data[p:end])}); e != nil {
			t.Fatal(e)
		}
	}
	r, e := w.handle(Request{Action: "commit"})
	if e != nil {
		t.Fatal(e)
	}
	return r["path"].(string)
}
func TestLargeUnicodeAndNoOverwrite(t *testing.T) {
	dir := t.TempDir()
	data := bytes.Repeat([]byte("中文🙂\n"), 500000)
	path := saveTest(t, dir, "网页.md", data)
	got, e := os.ReadFile(path)
	if e != nil || !bytes.Equal(got, data) {
		t.Fatal("content changed", e)
	}
	second := saveTest(t, dir, "网页.md", []byte("second"))
	if path == second {
		t.Fatal("overwritten")
	}
	got, _ = os.ReadFile(path)
	if !bytes.Equal(got, data) {
		t.Fatal("original changed")
	}
}
func TestInterruptedTransferCleanup(t *testing.T) {
	dir := t.TempDir()
	w := Writer{}
	_, e := w.handle(Request{Action: "begin", Filename: "partial.pdf", Size: 100, Target: Target{Mode: "absolute", Path: dir}})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = w.handle(Request{Action: "commit"}); e == nil {
		t.Fatal("accepted incomplete file")
	}
	w.abort()
	list, _ := os.ReadDir(dir)
	if len(list) != 0 {
		t.Fatal("partial file left")
	}
}
func TestRejectInvalidRequests(t *testing.T) {
	dir := t.TempDir()
	for _, r := range []Request{
		{Action: "begin", Filename: "../x.md", Target: Target{Mode: "absolute", Path: dir}},
		{Action: "begin", Filename: "x.exe", Target: Target{Mode: "absolute", Path: dir}},
		{Action: "begin", Filename: "x.md", Size: maxFile + 1, Target: Target{Mode: "absolute", Path: dir}},
		{Action: "begin", Filename: "x.md", Target: Target{Mode: "absolute", Path: "relative"}},
		{Action: "begin", Filename: "x.md", Target: Target{Mode: "absolute", Path: filepath.Join(dir, "missing")}},
		{Action: "chunk", Data: "invalid"}, {Action: "commit"},
	} {
		w := Writer{}
		if _, e := w.handle(r); e == nil {
			t.Fatalf("accepted %+v", r)
		}
		w.abort()
	}
}
func TestConcurrentNames(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); saveTest(t, dir, "same.html", []byte("intact")) }()
	}
	wg.Wait()
	list, _ := os.ReadDir(dir)
	if len(list) != 16 {
		t.Fatalf("got %d files", len(list))
	}
	for _, f := range list {
		v, _ := os.ReadFile(filepath.Join(dir, f.Name()))
		if string(v) != "intact" {
			t.Fatal("incomplete file")
		}
	}
}
func TestVaultRelativeAndEscape(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	root := filepath.Join(home, "仓库")
	os.MkdirAll(root, 0755)
	config := obsidianConfig()
	os.MkdirAll(filepath.Dir(config), 0755)
	b, _ := json.Marshal(map[string]any{"vaults": map[string]any{"id": map[string]string{"path": root}}})
	os.WriteFile(config, b, 0600)
	v, e := vaults()
	if e != nil || len(v) != 1 || v[0].Name != "仓库" {
		t.Fatal(v, e)
	}
	for _, rel := range []string{"../outside", "/absolute", `..\outside`, "a/../outside"} {
		if _, e = directory(Target{Mode: "vault", Vault: "id", RelativePath: rel}, true); e == nil {
			t.Fatal("accepted escape", rel)
		}
	}
	outside := t.TempDir()
	if e = os.Symlink(outside, filepath.Join(root, "link")); e == nil {
		if _, e = directory(Target{Mode: "vault", Vault: "id", RelativePath: "link/child"}, true); e == nil {
			t.Fatal("accepted symlink escape")
		}
		if _, e = os.Stat(filepath.Join(outside, "child")); !os.IsNotExist(e) {
			t.Fatal("created outside vault")
		}
	}
	dir, e := directory(Target{Mode: "vault", Vault: "id", RelativePath: "网页/剪藏"}, false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(dir); !os.IsNotExist(e) {
		t.Fatal("check created directories")
	}
	dir, e = directory(Target{Mode: "vault", Vault: "id", RelativePath: "网页/剪藏"}, true)
	if e != nil {
		t.Fatal(e)
	}
	saveTest(t, dir, "正文.md", []byte("# 测试"))
}
func TestFramedProtocolAndCleanup(t *testing.T) {
	var input bytes.Buffer
	dir := t.TempDir()
	for _, r := range []Request{{Action: "ping"}, {Action: "begin", Filename: "incomplete.md", Size: 42, Target: Target{Mode: "absolute", Path: dir}}, {Action: "chunk", Data: base64.StdEncoding.EncodeToString([]byte("abc"))}} {
		b, _ := json.Marshal(r)
		binary.Write(&input, binary.LittleEndian, uint32(len(b)))
		input.Write(b)
	}
	var output bytes.Buffer
	if e := serve(&input, &output); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(output.String(), `"version":"0.5.0"`) {
		t.Fatal("missing reply")
	}
	list, _ := os.ReadDir(dir)
	if len(list) != 0 {
		t.Fatal("disconnect left temp files")
	}
}
