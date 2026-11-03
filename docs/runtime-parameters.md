# 系统运行参数

运行参数管理位于参数管理抽屉的“运行参数”Tab。仅超级管理员可见，管理接口同时执行服务端认证与超级管理员鉴权。名称、说明、单位、操作和错误信息均有中英文翻译。

## 权威来源与生效边界

- `shared/{time,turn,quantity,length}-thresholds.js` 是内置默认值来源；`shared/runtime-params.js` 定义参数目录、接口地址、版本及关联校验；`shared/runtime-param-policy.js` 是可编辑性、单位和取值范围的唯一判定来源。
- 覆盖值存储在 `WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE` 指定的全局工作区文件中，与用户参数和模板变量分开。文件缺失表示尚未设置任何覆盖值；损坏、未知字段、非法参数和非法审计记录会报错。
- 服务进程（含 CLI）、agent-proxy 和 model-proxy 在导入业务模块前从 `NOOBOT_WORKSPACE_ROOT` 指定的工作区读取一次运行参数文件；浏览器先通过快照接口取得服务当前生效版本再加载应用；原生脚本子进程继承调用方快照。未初始化读取可编辑参数、重复安装均报错。
- 桌面壳和安装器在服务与工作区就绪前运行，不读取快照，它们消费的阈值是 `bootstrap` 固定约束。
- 保存后需重启服务、agent-proxy、model-proxy 并刷新浏览器才生效。界面中的“服务生效值”和生效版本指服务进程。

固定约束只读，原因分为：

- `bootstrap`：在服务和工作区就绪前读取（桌面壳、安装器）。
- `crossProcess`：服务与独立进程共享的契约（如启动协议、运行事件、附件、会话日志），单侧修改会破坏契约。
- `cryptography` / `protocol` / `presentation`：算法、协议字段或界面固定度量。

开发、质量和本地诊断脚本的阈值不属于运行参数，统一在 `scripts/lib/development-thresholds.mjs` 声明。

运行参数只接受范围内的整数；最小值/默认值/最大值等关联关系由协议统一验证。单位由键名后缀决定并由目录统一显示，说明文案不重复维护单位。

## 读取约定

- 可编辑阈值只在代码执行时读取 `*_THRESHOLDS.group.key`；模块顶层不得取叶子值、不得把阈值复制进常量、配置对象或导出别名，也不得在顶层实例化会读取阈值的单例。
- 依赖阈值的单例由入口组装时创建或在首次调用时惰性创建；进程入口先初始化快照，再导入并显式调用启动函数。
- 测试统一经 `@noobot/shared/testing/runtime-params` 安装快照；覆盖值通过 `NOOBOT_TEST_RUNTIME_OVERRIDES`（JSON）注入，并经协议校验，非法值直接失败。
- `npm run check:runtime-threshold-reads` 守护以上约定：`moduleScopeRead` 检查顶层读取，`importWithoutSnapshot` 在未安装快照的新进程中逐个导入库导出，两项基线均为 0。

## 保存与恢复

管理接口为 `GET/PUT /internal/admin/runtime-params`；前端通过 `/api` 代理访问。PUT 请求为 `{ revision, overrides }`，覆盖对象是本次完整目标集合。恢复默认会删除覆盖值。

存储使用独占锁、版本检查、临时文件刷盘与原子重命名。两个相同版本的不同修改只能有一个成功，另一个返回 409。每次有效变更记录版本、操作者、时间以及每项前后值。非法值在写入前拒绝；通用工作区文件写入不能直接修改受保护文件、其临时文件或符号链接别名。

锁文件内容为 `<pid>:<token>`，通过 link 原子发布。持锁进程存活时返回 `RUNTIME_PARAMS_BUSY`；持锁进程已退出时由下一次保存通过 rename 抢占回收；锁内容非法或回收期间被并发替换时返回 `RUNTIME_PARAMS_LOCK_CORRUPTED`，需运维检查。

快照接口 `GET /internal/runtime-params/snapshot` 用于登录前的浏览器启动，只返回当前生效的版本与数值覆盖，不返回审计身份及历史，也不提供写入功能。运行阈值不存放凭证。

## 验证入口

- `npm run test:all`：工作区测试，含权限、保存、锁、初始化、子进程和前端交互回归。
- `npm run test:quality-config`：扫描器和部署配置测试。
- `npm run check:quality`：质量门禁，含四类阈值扫描、i18n、依赖边界、格式和 lint。
- `npm run build`：启动页及前端生产构建。

阈值扫描基于 AST，覆盖命名常量/属性、函数默认参数、内联计时器、等待函数、`Date.now()` 偏移和环境变量默认值。HTTP 固定状态码与状态枚举按固定协议值处理；HTTP 超时等运行阈值仍受检查。扫描规则属于防回归门禁，不等于对任意语义或动态计算的形式化证明。
