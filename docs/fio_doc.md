# fio - Flexible I/O tester

> 本文档摘录自 [fio 官方文档](https://fio.readthedocs.io/en/latest/fio_doc.html)，供本仓库开发参考。完整参数与 I/O 引擎说明请以在线文档为准。

---

## 1.1 概述与历史

Fio 最初用于在测试特定 I/O 负载时避免反复编写专用测试程序。负载可能涉及多进程/多线程、多种 I/O 方式（如 mmap、异步 I/O），fio 需要足够灵活以模拟这些场景。

Fio 会按用户指定生成若干线程或进程执行特定类型的 I/O。典型用法是编写与目标 I/O 负载匹配的 **job file（任务文件）**。

## 1.2 源码与镜像

- 主仓库: https://git.kernel.org/pub/scm/linux/kernel/git/axboe/fio
- 快照: https://brick.kernel.dk/snaps/
- 镜像: https://github.com/axboe/fio

## 1.3 构建

```bash
./configure
make
make install
```

Linux 上使用 libaio 引擎需安装 libaio-devel / libaio-dev。

## 1.4 运行 fio

```bash
fio [options] [jobfile] ...
```

- 可传入多个 job 文件，fio 会按顺序执行（等同于使用 `stonewall`）。
- 单 job 时也可直接使用命令行参数，与 job 文件参数一一对应（如 `iodepth=2` → `--iodepth 2`）。
- 每个 `--name` 会开始一个新 job，后续参数归属该 job，直到下一个 `--name`。
- jobfile 为 `-` 时从标准输入读取。

## 1.5 工作原理简述

通过编写 **job file** 描述要模拟的 I/O 负载。文件中通常包含：

- **global** 段：共享的默认参数
- 一个或多个 **job 段**：具体任务

单个 job 主要涉及：

- **I/O 类型**：顺序/随机、读/写/混合，是否 direct I/O
- **块大小 (blocksize)**：单值或范围
- **I/O 大小 (size)**：总数据量
- **I/O 引擎 (ioengine)**：sync、libaio、mmap、splice 等
- **I/O 深度 (iodepth)**：异步时的队列深度
- **目标文件/设备**：文件名或设备路径
- **线程/进程与同步**：numjobs、stonewall 等

## 1.6 常用命令行选项

| 选项 | 说明 |
|------|------|
| `--output=filename` | 输出写入文件 |
| `--output-format=normal\|terse\|json\|json+` | 输出格式 |
| `--section=name` | 只运行指定 section |
| `--parse-only` | 仅解析选项，不执行 I/O |
| `--readonly` | 只读安全检查，禁止写/trim |
| `--help` | 帮助 |
| `--version` | 版本 |

## 1.7 Job 文件格式

- 类 ini 格式，`[section]` 为 job 名，`global` 为保留名表示全局默认。
- 每行一个参数，`;` 或 `#` 开头为注释。
- 某 job 可覆盖其上方 `global` 中的参数。
- 可用 `include filename` 引入外部 `.fio` 文件。

### 简单示例

两个进程随机读 128MiB：

```ini
[global]
rw=randread
size=128m

[job1]
[job2]
```

等价命令行：

```bash
fio --name=global --rw=randread --size=128m --name=job1 --name=job2
```

### 环境变量

选项值中可使用 `${VARNAME}`，运行时替换为环境变量。

### 保留关键字

- `$pagesize`：系统页大小  
- `$mb_memory`：内存总大小（MB）  
- `$ncpus`：在线 CPU 数  

支持简单运算，如：`size=8*$mb_memory`。

## 1.8 Job 参数类型简述

- **str**：字符串  
- **time**：时间，可带后缀 d/h/m/s/ms/us  
- **int**：整数，可带 0x 十六进制、K/M/G 等单位（默认 kb_base=1024 时 k=1024）  
- **bool**：0/1 或 true/false  
- **irange**：范围，如 1024-4096 或 1k:4k  

表达式可用 `()` 包裹，支持 + - * / % ^。

## 1.9 与本项目的关系

本仓库（fio-webui）通过 Go 调用 fio 命令行，根据 Web UI 的配置生成 job 文件或命令行参数，并解析 fio 输出用于展示。实现时可参考：

- `internal/fio/options.go`：与 fio 选项对应的结构
- `internal/fio/job.go`：生成 job 文件或命令行
- `internal/fio/stream_parser.go`、`logparser.go`：解析 fio 输出

更完整的 **read/write 类型**、**ioengine**、**blocksize**、**iodepth** 等参数说明见官方文档 [Job file parameters](https://fio.readthedocs.io/en/latest/fio_doc.html#job-file-parameters) 与 [I/O engine](https://fio.readthedocs.io/en/latest/fio_doc.html#i-o-engine) 章节。

---

**完整文档**: [https://fio.readthedocs.io/en/latest/fio_doc.html](https://fio.readthedocs.io/en/latest/fio_doc.html)
