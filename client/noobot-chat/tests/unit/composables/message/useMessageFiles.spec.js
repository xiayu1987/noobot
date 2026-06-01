import { describe, expect, it } from "vitest";
import { useMessageFiles } from "../../../../src/composables/message/useMessageFiles";

describe("useMessageFiles", () => {
  it("recognizes markdown file path without trailing full-width status suffix", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "已输出文件：workspace/admin/assessment_center_report_deepseek_glm_5_1/05_落地挑战与发展趋势.md（已完成）",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("05_落地挑战与发展趋势.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/05_落地挑战与发展趋势.md",
    );
  });

  it("trims any trailing suffix after file extension", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "输出：workspace/admin/assessment_center_report_deepseek_glm_5_1/04_实施流程与考官机制.md已完成并归档",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("04_实施流程与考官机制.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/04_实施流程与考官机制.md",
    );
  });

  it("recognizes workplace typo prefix as workspace-compatible path", () => {
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content:
        "已输出文件：workplace/admin/assessment_center_report_deepseek_glm_5_1/01_概述与价值.md（已完成）",
    };
    const { writtenFiles } = useMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });
    expect(writtenFiles.value).toHaveLength(1);
    expect(writtenFiles.value[0].fileName).toBe("01_概述与价值.md");
    expect(writtenFiles.value[0].relativePath).toBe(
      "assessment_center_report_deepseek_glm_5_1/01_概述与价值.md",
    );
  });
});
