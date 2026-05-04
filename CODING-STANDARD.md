# Noobot Coding Standard / Noobot 编码规范

For AI coding only. Keep changes small and strict.  
供 AI 编程使用。规则从严，改动尽量小。

## Rules / 规则

1. **No single-letter names** (`t`, `i`, `x` are forbidden).  
   **禁止单字母命名**（函数/变量都不允许）。

2. **No legacy compatibility code** unless explicitly required.  
   **禁止旧结构兼容代码**，除非明确要求。

3. **All user-facing text must be bilingual** (`zh-CN`, `en-US`).  
   **所有用户可见文案必须中英双语**（`zh-CN`、`en-US`）。

4. **No hardcoded UI/error text** in business logic. Use i18n keys.  
   **业务逻辑中禁止硬编码文案**，统一走 i18n key。

5. **Tool docs format**: “what it does + input + output”.  
   **工具描述格式**：做什么 + 输入什么 + 返回什么。

6. **Param docs format**:  
   - with options: `a|b|c + short note`  
   - no options: short note only  
   **参数描述格式**：  
   - 有可选项：`a|b|c + 简要说明`  
   - 无可选项：仅简要说明

7. **Frontend must handle long content + mobile layout**.  
   **前端必须适配长内容与移动端布局**。

8. **Display limit != counter limit** (e.g. show last 10, count keeps increasing).  
   **展示条数限制不等于计数限制**（如只显示 10 条，但计数持续累加）。

## Pre-merge checklist / 提交前检查

- Build/syntax checks pass. / 构建与语法检查通过。  
- zh/en keys are aligned. / 中英文 key 对齐。  
- No single-letter names added. / 未新增单字母命名。  
- No new hardcoded user text. / 未新增硬编码用户文案。  
