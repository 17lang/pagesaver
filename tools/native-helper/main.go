// Pagesaver native writer. Standard library only; no network listener or daemon.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const hostName = "app.pagesaver.save"
const extensionID = "pagesaver@pagesaver.local"
const maxFile = 512 * 1024 * 1024
const maxMessage = 384 * 1024

type Target struct {
	Mode         string `json:"mode"`
	Path         string `json:"path"`
	Vault        string `json:"vault"`
	RelativePath string `json:"relativePath"`
}
type Request struct {
	Action   string `json:"action"`
	Filename string `json:"filename"`
	Target   Target `json:"target"`
	Size     int64  `json:"size"`
	Data     string `json:"data"`
}
type Vault struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}
type Writer struct {
	file              *os.File
	temp, dir, name   string
	expected, written int64
}

func obsidianConfig() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "obsidian", "obsidian.json")
	case "windows":
		return filepath.Join(os.Getenv("APPDATA"), "obsidian", "obsidian.json")
	default:
		root := os.Getenv("XDG_CONFIG_HOME")
		if root == "" {
			root = filepath.Join(home, ".config")
		}
		return filepath.Join(root, "obsidian", "obsidian.json")
	}
}
func vaults() ([]Vault, error) {
	data, err := os.ReadFile(obsidianConfig())
	if os.IsNotExist(err) {
		return []Vault{}, nil
	}
	if err != nil {
		return nil, errors.New("无法读取 Obsidian 仓库，请检查访问权限。")
	}
	var config struct {
		Vaults map[string]struct {
			Path string `json:"path"`
		} `json:"vaults"`
	}
	if json.Unmarshal(data, &config) != nil {
		return nil, errors.New("无法读取 Obsidian 仓库配置。")
	}
	out := []Vault{}
	for id, v := range config.Vaults {
		if filepath.IsAbs(v.Path) {
			out = append(out, Vault{id, filepath.Base(v.Path), v.Path})
		}
	}
	return out, nil
}
func directory(t Target, create bool) (string, error) {
	var dir, root string
	switch t.Mode {
	case "absolute":
		if !filepath.IsAbs(t.Path) {
			return "", errors.New("请输入完整的文件夹路径。")
		}
		dir = filepath.Clean(t.Path)
	case "vault":
		list, err := vaults()
		if err != nil {
			return "", err
		}
		for _, v := range list {
			if v.ID == t.Vault {
				root = v.Path
				break
			}
		}
		if root == "" {
			return "", errors.New("找不到这个仓库，请重新选择。")
		}
		relative := strings.ReplaceAll(t.RelativePath, "\\", "/")
		if strings.HasPrefix(relative, "/") || strings.Contains(relative, ":") {
			return "", errors.New("请填写仓库内的相对路径。")
		}
		for _, part := range strings.Split(relative, "/") {
			if part == ".." || part == "." {
				return "", errors.New("保存位置不能超出仓库。")
			}
		}
		actual, err := filepath.EvalSymlinks(root)
		if err != nil {
			return "", errors.New("仓库文件夹不存在或无法访问。")
		}
		root = actual
		dir = root
		// Inspect every component, including existing symlinks, before creating descendants.
		for _, part := range strings.Split(relative, "/") {
			if part == "" {
				continue
			}
			dir = filepath.Join(dir, part)
			if _, err := os.Lstat(dir); os.IsNotExist(err) {
				if !create {
					continue
				}
				if err = os.Mkdir(dir, 0755); err != nil && !os.IsExist(err) {
					return "", errors.New("无法创建保存文件夹，请检查访问权限。")
				}
			}
			actual, err := filepath.EvalSymlinks(dir)
			if err != nil {
				if !create && os.IsNotExist(err) {
					continue
				}
				return "", errors.New("无法访问保存文件夹。")
			}
			rel, err := filepath.Rel(root, actual)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				return "", errors.New("保存位置不能超出仓库。")
			}
			dir = actual
		}
	default:
		return "", errors.New("请选择保存位置。")
	}
	if strings.ContainsAny(dir, "\x00\r\n") {
		return "", errors.New("文件夹路径无效。")
	}
	info, err := os.Stat(dir)
	if !create && t.Mode == "vault" && os.IsNotExist(err) {
		// Check the nearest existing ancestor; subfolders are created only on save.
		p := dir
		for {
			p = filepath.Dir(p)
			if info, err = os.Stat(p); err == nil {
				break
			}
			if p == filepath.Dir(p) {
				break
			}
		}
	}
	if err != nil || !info.IsDir() {
		return "", errors.New("文件夹不存在或无法访问，请检查路径。")
	}
	return dir, nil
}
func (w *Writer) abort() {
	if w.file != nil {
		w.file.Close()
	}
	if w.temp != "" {
		os.Remove(w.temp)
	}
	*w = Writer{}
}
func (w *Writer) handle(r Request) (map[string]any, error) {
	switch r.Action {
	case "ping":
		return map[string]any{"version": "0.5.0", "platform": runtime.GOOS}, nil
	case "vaults":
		v, e := vaults()
		return map[string]any{"vaults": v}, e
	case "check":
		dir, e := directory(r.Target, false)
		if e != nil {
			return nil, e
		}
		probe := dir
		for {
			if info, err := os.Stat(probe); err == nil && info.IsDir() {
				break
			}
			next := filepath.Dir(probe)
			if next == probe {
				return nil, errors.New("无法访问保存文件夹。")
			}
			probe = next
		}
		f, e := os.CreateTemp(probe, ".pagesaver-check-*")
		if e != nil {
			return nil, errors.New("无法写入这个文件夹，请检查访问权限。")
		}
		name := f.Name()
		f.Close()
		os.Remove(name)
		return map[string]any{"path": dir}, nil
	case "begin":
		if w.file != nil {
			return nil, errors.New("已有保存正在进行。")
		}
		if r.Size < 0 || r.Size > maxFile {
			return nil, errors.New("文件太大，请选择较小的页面。")
		}
		if r.Filename == "" || strings.ContainsAny(r.Filename, "/\\:\x00\r\n") || r.Filename == "." || r.Filename == ".." {
			return nil, errors.New("文件名无效。")
		}
		ext := strings.ToLower(filepath.Ext(r.Filename))
		if ext != ".pdf" && ext != ".html" && ext != ".md" {
			return nil, errors.New("不支持这种文件。")
		}
		dir, e := directory(r.Target, true)
		if e != nil {
			return nil, e
		}
		f, e := os.CreateTemp(dir, ".pagesaver-*")
		if e != nil {
			return nil, errors.New("无法写入这个文件夹，请检查访问权限。")
		}
		w.file = f
		w.temp = f.Name()
		w.dir = dir
		w.name = r.Filename
		w.expected = r.Size
		return map[string]any{}, nil
	case "chunk":
		if w.file == nil {
			return nil, errors.New("保存尚未开始。")
		}
		data, e := base64.StdEncoding.DecodeString(r.Data)
		if e != nil || len(data) > 192*1024 || w.written+int64(len(data)) > w.expected {
			return nil, errors.New("文件传输不完整，请重试。")
		}
		n, e := w.file.Write(data)
		w.written += int64(n)
		if e != nil || n != len(data) {
			return nil, errors.New("写入失败，请检查剩余空间和访问权限。")
		}
		return map[string]any{"bytes": w.written}, nil
	case "commit":
		if w.file == nil || w.written != w.expected {
			return nil, errors.New("文件传输不完整，请重试。")
		}
		if e := w.file.Sync(); e != nil {
			return nil, errors.New("文件未能完整写入，请检查剩余空间。")
		}
		if e := w.file.Close(); e != nil {
			return nil, errors.New("文件未能完整写入。")
		}
		w.file = nil
		ext := filepath.Ext(w.name)
		stem := strings.TrimSuffix(w.name, ext)
		for i := 0; i < 10000; i++ {
			name := w.name
			if i > 0 {
				name = fmt.Sprintf("%s (%d)%s", stem, i, ext)
			}
			path := filepath.Join(w.dir, name)
			// Link publishes a fully synced file atomically and never replaces an existing name.
			e := os.Link(w.temp, path)
			if os.IsExist(e) {
				continue
			}
			if e != nil {
				return nil, errors.New("无法完成保存，请检查文件夹权限及磁盘是否支持硬链接。")
			}
			os.Remove(w.temp)
			w.temp = ""
			if d, e := os.Open(w.dir); e == nil {
				d.Sync()
				d.Close()
			}
			result := map[string]any{"path": path, "filename": name, "bytes": w.written}
			*w = Writer{}
			return result, nil
		}
		return nil, errors.New("同名文件太多，请换一个文件名。")
	}
	return nil, errors.New("不支持这个操作。")
}
func serve(in io.Reader, out io.Writer) error {
	reader := bufio.NewReader(in)
	w := Writer{}
	defer w.abort()
	for {
		var size uint32
		if e := binary.Read(reader, binary.LittleEndian, &size); e != nil {
			if e == io.EOF {
				return nil
			}
			return e
		}
		if size == 0 || size > maxMessage {
			return errors.New("invalid native message size")
		}
		data := make([]byte, size)
		if _, e := io.ReadFull(reader, data); e != nil {
			return e
		}
		var r Request
		var result map[string]any
		var err error
		if json.Unmarshal(data, &r) != nil {
			err = errors.New("无法读取保存请求。")
		} else {
			result, err = w.handle(r)
		}
		if err != nil {
			w.abort()
			result = map[string]any{"ok": false, "error": err.Error()}
		} else {
			result["ok"] = true
		}
		encoded, e := json.Marshal(result)
		if e != nil {
			return e
		}
		if e = binary.Write(out, binary.LittleEndian, uint32(len(encoded))); e != nil {
			return e
		}
		if _, e = out.Write(encoded); e != nil {
			return e
		}
	}
}
func main() {
	if len(os.Args) > 1 && os.Args[1] == "--install" {
		if e := install(); e != nil {
			fmt.Fprintln(os.Stderr, "安装失败：", e)
			os.Exit(1)
		}
		return
	}
	if e := serve(os.Stdin, os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
