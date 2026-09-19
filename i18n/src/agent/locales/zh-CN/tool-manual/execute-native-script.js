/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  NATIVE_SCRIPT_CAPABILITY_BINDINGS,
  NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS,
  NATIVE_SCRIPT_FORBIDDEN_PROPERTIES,
  NATIVE_SCRIPT_FORBIDDEN_SYNTAX,
  NATIVE_SCRIPT_RESULT_FIELD,
} from "@noobot/execution-isolation-protocol/native-script";

export const EXECUTE_NATIVE_SCRIPT_MANUAL = {
  execute_native_script: {
    summary:
      "在受限沙箱里执行 Node.js 异步函数体，通过注入的能力对象操作浏览器、文档、媒体与文件。",
    usage: ["execute_native_script({ script_body, inputs, arguments, riskLevel })"],
    params: {
      script_body:
        "异步函数体源码。执行前会对整个源码做 AST 静态校验；能力通过绑定注入，不能自行 import 或 require。",
      inputs: "只读输入数组，每项为 { source: 逻辑路径或 attachmentRef }。",
      arguments: "结构化非敏感参数对象，脚本内通过 args 读取。",
      riskLevel:
        "脚本风险等级：low、medium、high 或 critical。具有破坏性的脚本必须标记为 critical。",
    },
    bindings: {
      files:
        "读写，全部为异步方法必须 await：const token = await files.input(index) 取 input:// 令牌；文本用 await files.readText(token)、readJson(token)、writeText(token, text)、writeJson(token, value)；二进制用 await files.readBase64(token)、writeBase64(token, base64) 与 await files.copy(sourceToken, destinationToken)，copy 返回 { path, bytes }，是把 temp:// 二进制产物提升为 output:// 正式附件的通道。读写只接受 input://、output:// 或 temp:// 令牌，不接受逻辑路径或宿主路径。",
      output:
        "产物，全部为异步方法必须 await：await output.file(relativePath) 返回 output:// 令牌；await output.tempDirectory(relativePath) 返回 temp:// 目录令牌；await output.tempFile(relativePath) 或 await output.tempFile(tempDirectoryToken, fileName) 返回 temp:// 文件令牌。",
      ui: "共享用户交互通道，见 interaction 段。",
      args: "本次调用传入的 arguments 对象。",
      log: "log(...values) 写入 stdout 执行日志，用于过程诊断；结构化结果应通过顶层 return 返回。",
    },
    result: {
      [NATIVE_SCRIPT_RESULT_FIELD]:
        "顶层 return 的 JSON 值。未写 return 或返回 undefined 时省略；函数、Symbol、BigInt、非有限数、循环引用及嵌套 undefined 不可返回。",
      stdout: "log(...values) 产生的文本执行日志。",
      attachments: "只有写入 output:// 的文件会作为正式附件返回。",
    },
    validation: {
      timing:
        "运行任何脚本语句前，先解析并校验完整 script_body；任一违规都会拒绝整段脚本，脚本零执行。",
      forbiddenIdentifiers: `禁用标识符：${NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS.join(", ")}。标识符按 AST 检查，因此 typeof process 同样会被拒绝。`,
      forbiddenSyntax: `禁用语法节点：${NATIVE_SCRIPT_FORBIDDEN_SYNTAX.join(", ")}。`,
      propertyAccess: `禁用属性名：${NATIVE_SCRIPT_FORBIDDEN_PROPERTIES.join(", ")}；同时禁止 values[key] 一类动态计算属性访问，只允许字面量计算属性。`,
    },
    interaction: {
      waitForUser:
        "await ui.waitForUser({ content, fields }) 挂起脚本并向用户提问，返回用户填写结果；等待期间超时计时暂停。fields 接受字段数组或 { fields: [...] }，每项必须含 name 与 displayName，形状不合法直接抛错，不会静默降级为确认弹窗。",
    },
    capabilities: {
      browser: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.browser,
        summary: "浏览器页面、定位器、截图、持久化登录态与有头人工操作。",
        usage: [
          "await browser.newPage({ headed, profile, viewport })",
          "await browser.closeProfile({ profile })",
        ],
        api: {
          newPage:
            '返回受限页面，支持 goto、setContent、title、url、content、DOM 操作、screenshot、close，不支持 evaluate。page.screenshot 与 locator.screenshot 返回 { path, bytes }，不回传图片字节；省略 path 时返回 { path: "", bytes, base64 }。',
          headed:
            "headed 为 true 时启动有头窗口，浏览器由主进程持有，脚本结束后窗口保留，便于人工登录或人工确认。",
          profile:
            "profile 为命名持久化配置名，缺省 default。同名 profile 跨脚本、跨轮次复用同一登录态。",
          closeProfile: "显式关闭指定 profile 的窗口与会话，返回是否实际关闭。",
        },
        notes: [
          "有头模式下不做请求拦截，页面可自由访问外部资源；无头模式仍按协议校验。",
          "持久化 profile 会保留 Cookie 与登录态，按用户隔离存放。",
          "典型人工登录流程：headed 打开页面，ui.waitForUser 等待用户完成登录，再继续抓取。",
        ],
        pitfalls: [
          "脚本结束时无头页面会被回收，有头页面不会。",
          "profile 名只接受受限字符集，不能包含路径分隔符或 ..。",
        ],
      },
      document: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.document,
        summary: "通过 LibreOffice 把声明的任务文件转换为 PDF、DOCX、XLSX、PPTX 等格式。",
        usage: ["await libreoffice.convert({ input, outputDirectory, outputFormat })"],
        api: {
          convert:
            "input 接受本轮 input://、output:// 或 temp:// 文件；outputDirectory 接受 output.directory 或 await output.tempDirectory(...) 返回的目录令牌；返回 { code, stdout, stderr, output, outputBytes }。",
        },
        notes: ["省略 outputDirectory 时写入 output://，产物会作为正式附件收集。"],
        pitfalls: ["转换成功但未产生非空目标文件时，调用会失败而不是返回空产物。"],
      },
      media: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.media,
        summary: "通过 FFmpeg 处理音视频，并通过 FFprobe 探测媒体信息。",
        usage: ["await ffmpeg.run({ args: [...] })", "await ffprobe.run({ args: [...] })"],
        api: {
          ffmpeg:
            "执行固定 FFmpeg 参数数组并返回 { code, stdout, stderr }；code 恒为 0，非零退出直接抛错。",
          ffprobe:
            "执行固定 FFprobe 参数数组并返回 { code, stdout, stderr }；code 恒为 0，非零退出直接抛错。",
        },
        notes: ["参数中的 input://、output://、temp:// 令牌会按任务目录解析。"],
        pitfalls: ["禁止宿主路径、父级穿越、外部协议和可加载额外脚本或附件的危险参数。"],
      },
    },
    notes: [
      `顶层 return 值通过 ${NATIVE_SCRIPT_RESULT_FIELD} 返回，但不会成为文件附件；正式附件必须写入 output://。`,
      "task-local 的 output:// 与 temp:// 仅本次调用有效，跨工具只传 attachmentRef。",
    ],
    pitfalls: [
      "长时间人工操作应放在 ui.waitForUser 里等待，不要用轮询或长睡眠占住脚本。",
      "静态校验以整个 script_body 为单位；独立检查或批量断言宜拆成小批次，避免一处违规让整批零执行。",
    ],
  },
};
