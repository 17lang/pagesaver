# Pagesaver

[中文说明](README.zh-CN.md)

Save a full page or a selected area as a single-page PDF, archive a page as one complete HTML file, or extract an article as Markdown. For Firefox and Zen, desktop Firefox 140 or later.

## Start saving

Install the extension and choose a save button. **No companion app is needed for normal downloads.** Files use your browser download settings. The interface follows your browser language: Chinese or English, with English as the fallback.

The Firefox Add-ons listing is being prepared. Until it is approved, download `pagesaver.xpi` from Releases and temporarily load it at `about:debugging#/runtime/this-firefox` → Load Temporary Add-on. Temporary installations must be loaded again after a browser restart.

## Send Markdown to Obsidian

In Settings → Markdown, choose **Send to Obsidian**. Enter the vault name exactly as shown in Obsidian, or leave it empty to use the current vault. Set an optional folder within the vault and save settings. Obsidian must be installed; no Pagesaver helper is needed for this mode.

This reuses Obsidian Web Clipper's save-only clipboard/URI flow. Saving replaces the clipboard with the article and opens Obsidian. Your browser may ask permission to open the app. Check Obsidian to confirm that the note was created; Pagesaver cannot verify writes performed by another app. Existing notes are not explicitly overwritten.

## Optional: save directly into a chosen folder

For automatic saving to arbitrary local folders, install the optional Pagesaver save helper once **on each computer**. The macOS package supports Apple silicon and Intel Macs:

1. [Download the Mac save helper](https://github.com/17lang/pagesaver/releases/latest/download/pagesaver-save-macos.zip) and unzip it.
2. Double-click `安装保存工具.command` (Install save helper).
3. In Settings, choose a local folder or the advanced Obsidian-folder mode, then Check connection. Refresh vaults if needed.

PDF, HTML and Markdown keep separate settings. PDF/HTML may follow Markdown's actual folder; this needs the helper too. If following Send to Obsidian, specify a vault name. Duplicate vault names require choosing a folder explicitly. Existing filenames get numbered; configured save failures are reported rather than silently sent elsewhere.

The helper runs only when requested, has no network listener, and sends no data to a cloud service. The current helper is a development build, locally signed but not Apple-notarized. Windows/Linux sources are provided, but have not received runtime acceptance testing or end-user installation packages.

## Privacy and compatibility

Page processing runs locally. HTML archiving fetches resources from their original websites. Optional Obsidian handoff uses the local clipboard/app; the optional helper receives content only to write local files. No analytics, advertising or developer-operated upload service. See [Privacy](PRIVACY.md).

Browser-internal pages and the Firefox Add-ons website restrict extension access. Extremely long or complex pages and video archives may have limitations. PDF uses native screenshots, pdf-lib and a searchable text layer where available; HTML uses SingleFile; Markdown uses Defuddle. No highlighter, reader or AI features from Obsidian Clipper are included.

## Build and test

Python 3.9+ builds the XPI with no dependency installation:

```sh
python3 tools/package-extension.py --output dist/pagesaver.xpi
node --test tools/test-destinations.cjs tools/test-i18n.cjs
```

The optional helper uses Go 1.23+ and only its standard library:

```sh
cd tools/native-helper
go test -race ./...
go vet ./...
go build -trimpath -o pagesaver-save .
./pagesaver-save --install
```

For the macOS universal package, use `tools/build-release.py` with Go and macOS command-line tools. Rebuilding the SingleFile bridge: `node tools/wrap-kernel.mjs`. Versioned upstream artifacts and hashes are in [vendor provenance](tools/vendor/provenance.json). See [Firefox publication preparation](docs/FIREFOX-PUBLISHING.md) for reviewer notes and current release limits.

## License and credits

Pagesaver is distributed under **AGPL-3.0-or-later**, including its own source. Third-party components retain their licenses. See [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) and [Obsidian Clipper reuse details](options/UPSTREAM.md).

Support and bug reports: GitHub Issues in this repository. Do not include private page content, vault paths or credentials in a public report.
