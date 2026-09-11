/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTE_NATIVE_SCRIPT_MANUAL = {
  execute_native_script: {
    summary:
      "在受限沙箱里执行 Node.js 异步函数体，通过注入的能力对象操作浏览器、文档、媒体与文件。",
    usage: ["execute_native_script({ script_body, inputs, arguments, riskLevel })"],
    params: {
      script_body: "异步函数体源码。能力通过绑定注入，不需要也不能自行 import 或 require。",
      inputs: "只读输入数组，每项为 { source: 逻辑路径或 attachmentRef }。",
      arguments: "结构化非敏感参数对象，脚本内通过 args 读取。",
      riskLevel: "脚本风险等级：low、medium、high 或 critical。具有破坏性的脚本必须标记为 critical。",
    },
    bindings: {
      browser: "浏览器能力，见 browser 段。",
      libreoffice: "文档转换：await libreoffice.convert({ input, outputDirectory, outputFormat })。",
      ffmpeg: "音视频处理：await ffmpeg.run({ args: [...] })。",
      ffprobe: "媒体探测：await ffprobe.run({ args: [...] })。",
      files:
        "读写，全部为异步方法必须 await：const token = await files.input(index) 取 input:// 令牌；await files.readText(token)、readJson(token)、writeText(token, text)、writeJson(token, value)。读写只接受 input://、output:// 或 temp:// 令牌，不接受逻辑路径或宿主路径。",
      output:
        "产物，全部为异步方法必须 await：await output.file(relativePath) 返回 output:// 令牌；await output.tempDirectory(relativePath) 返回 temp:// 目录令牌；await output.tempFile(relativePath) 或 await output.tempFile(tempDirectoryToken, fileName) 返回 temp:// 文件令牌。",
      ui: "用户操作通道，见 ui 段。",
      args: "本次调用传入的 arguments 对象。",
      log: "log(message) 输出到执行日志。",
    },
    browser: {
      newPage:
        "await browser.newPage({ headed, profile, viewport }) 返回受限页面，支持 goto、setContent、title、url、content、DOM 操作、screenshot、close，不支持 evaluate。",
      headed:
        "headed 为 true 时启动有头窗口，浏览器由主进程持有，脚本结束后窗口保留，便于人工登录或人工确认。",
      profile:
        "profile 为命名持久化配置名，缺省 default。同名 profile 跨脚本、跨轮次复用同一登录态。",
      closeProfile:
        "await browser.closeProfile({ profile }) 显式关闭该 profile 的窗口与会话，返回是否实际关闭。",
    },
    ui: {
      waitForUser:
        "await ui.waitForUser({ content, fields }) 挂起脚本并向用户提问，返回用户填写结果；等待期间超时计时暂停。",
    },
    notes: [
      "有头模式下不做请求拦截，页面可自由访问外部资源；无头模式仍按协议校验。",
      "持久化 profile 会保留 Cookie 与登录态，按用户隔离存放，同一用户的后续脚本可直接读到此前登录结果。",
      "典型人工登录流程：headed 打开页面，ui.waitForUser 等用户登录完成，脚本继续抓取，最后按需 closeProfile。",
      "只有 output:// 文件会作为正式附件返回，脚本 return 值不作为文件输出。",
      "task-local 的 output:// 与 temp:// 仅本次调用有效，跨工具只传 attachmentRef。",
      "LibreOffice 输入可用本轮存在的 input://、output:// 或 temp:// 文件；outputDirectory 接受 output.directory 或已 await 的 temp:// 目录令牌。",
    ],
    pitfalls: [
      "脚本结束时无头页面会被回收，有头页面不会，不要依赖脚本结束来关闭有头窗口。",
      "profile 名只接受受限字符集，不能包含路径分隔符或 .. ，用户身份由运行时注入不可自行指定。",
      "长时间人工操作应放在 ui.waitForUser 里等待，不要用轮询或长睡眠占住脚本。",
    ],
  },
};
