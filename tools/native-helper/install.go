package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func install() error {
	home, e := os.UserHomeDir()
	if e != nil {
		return e
	}
	var root string
	var locations []string
	switch runtime.GOOS {
	case "darwin":
		root = filepath.Join(home, "Library", "Application Support", "Pagesaver")
		for _, browser := range []string{"Mozilla", "Zen"} {
			locations = append(locations, filepath.Join(home, "Library", "Application Support", browser, "NativeMessagingHosts"))
		}
	case "windows":
		root = filepath.Join(os.Getenv("LOCALAPPDATA"), "Pagesaver")
		locations = []string{root}
	default:
		root = filepath.Join(home, ".local", "share", "pagesaver")
		locations = []string{filepath.Join(home, ".mozilla", "native-messaging-hosts"), filepath.Join(home, ".zen", "native-messaging-hosts")}
	}
	if e = os.MkdirAll(root, 0700); e != nil {
		return e
	}
	name := "pagesaver-save"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(root, name)
	// Validate every existing registration before changing the installed executable.
	for _, dir := range locations {
		path := filepath.Join(dir, hostName+".json")
		if old, err := os.ReadFile(path); err == nil {
			var m map[string]any
			if json.Unmarshal(old, &m) != nil || m["name"] != hostName || m["path"] != dest {
				return fmt.Errorf("已有其他保存工具配置，未覆盖：%s", path)
			}
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	current, e := os.Executable()
	if e != nil {
		return e
	}
	if filepath.Clean(current) != dest {
		data, e := os.ReadFile(current)
		if e != nil {
			return e
		}
		// Never overwrite an executable in place; keep the previous version until replacement succeeds.
		f, e := os.CreateTemp(root, ".install-*")
		if e != nil {
			return e
		}
		tmp := f.Name()
		defer os.Remove(tmp)
		if _, e = f.Write(data); e != nil {
			f.Close()
			return e
		}
		if e = f.Chmod(0755); e != nil {
			f.Close()
			return e
		}
		if e = f.Close(); e != nil {
			return e
		}
		if runtime.GOOS == "windows" {
			// Windows cannot replace an executable currently in use; surface the failure.
			if _, e = os.Stat(dest); e == nil {
				return fmt.Errorf("保存工具已安装，请先移走旧的 %s 再安装", dest)
			}
		}
		if e = os.Rename(tmp, dest); e != nil {
			return e
		}
	}
	manifest := map[string]any{"name": hostName, "description": "Pagesaver local file writer", "path": dest, "type": "stdio", "allowed_extensions": []string{extensionID}}
	data, _ := json.MarshalIndent(manifest, "", "  ")
	for _, dir := range locations {
		if e = os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		path := filepath.Join(dir, hostName+".json")
		if old, e := os.ReadFile(path); e == nil {
			var m map[string]any
			if json.Unmarshal(old, &m) != nil || m["name"] != hostName || m["path"] != dest {
				return fmt.Errorf("已有其他保存工具配置，未覆盖：%s", path)
			}
		}
		if e = os.WriteFile(path, data, 0600); e != nil {
			return e
		}
		if runtime.GOOS == "windows" {
			if output, e := exec.Command("reg", "add", `HKCU\Software\Mozilla\NativeMessagingHosts\`+hostName, "/ve", "/t", "REG_SZ", "/d", path, "/f").CombinedOutput(); e != nil {
				return fmt.Errorf("注册失败：%s", output)
			}
		}
	}
	fmt.Println("Pagesaver 保存工具已安装。请在扩展设置中点击“检查连接”。")
	return nil
}
