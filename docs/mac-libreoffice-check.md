# macOS LibreOffice 启动卡住排查

用于排查 macOS 打包后启动界面一直停在：

```txt
Checking LibreOffice...
```

请在 mac 终端中按顺序执行下面命令，观察哪一条卡住、无输出或报错。

## 1. 检查 LibreOffice App 是否存在

```bash
ls -ld "/Applications/LibreOffice.app"
```

```bash
ls -ld "$HOME/Applications/LibreOffice.app"
```

如果 `/Applications/LibreOffice.app` 存在，通常说明 LibreOffice 已安装。

## 2. 检查命令行是否可用

```bash
libreoffice --version
```

```bash
soffice --version
```

macOS 上即使安装了 LibreOffice，这两条也可能报：

```txt
command not found
```

这不一定代表 LibreOffice 没安装，只表示命令没有加入 PATH。

## 3. 检查 Homebrew

```bash
brew --version
```

如果前面都没有检测到 LibreOffice，安装逻辑后续可能会执行：

```bash
brew install --cask libreoffice
```

建议先不要直接执行安装命令，先确认前面的检查结果。

## 4. 使用 Python 加超时测试命令是否卡住

### 测试 libreoffice

```bash
python3 - <<'PY'
import subprocess
cmd = ["libreoffice", "--version"]
try:
    r = subprocess.run(cmd, timeout=15, capture_output=True, text=True)
    print("returncode:", r.returncode)
    print("stdout:", r.stdout)
    print("stderr:", r.stderr)
except FileNotFoundError as e:
    print("FileNotFoundError:", e)
except subprocess.TimeoutExpired:
    print("TIMEOUT")
PY
```

### 测试 soffice

```bash
python3 - <<'PY'
import subprocess
cmd = ["soffice", "--version"]
try:
    r = subprocess.run(cmd, timeout=15, capture_output=True, text=True)
    print("returncode:", r.returncode)
    print("stdout:", r.stdout)
    print("stderr:", r.stderr)
except FileNotFoundError as e:
    print("FileNotFoundError:", e)
except subprocess.TimeoutExpired:
    print("TIMEOUT")
PY
```

## 5. 重点观察

- `/Applications/LibreOffice.app` 存在：客户端应该直接跳过 LibreOffice 检查。
- `libreoffice --version` 或 `soffice --version` 报 `command not found`：macOS 常见，不一定是问题。
- `brew --version` 很慢或卡住：可能卡在 Homebrew 初始化。
- `brew install --cask libreoffice` 卡住：可能是网络、权限或交互确认问题。

## 6. 回传信息

请把以下信息发回用于继续定位：

1. 上面每条命令的输出。
2. 如果某条命令卡住，说明具体卡在哪一条。
3. 应用启动日志中从 `Checking LibreOffice...` 开始之后的日志内容。
