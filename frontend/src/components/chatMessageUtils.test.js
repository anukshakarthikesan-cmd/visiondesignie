import { describe, expect, it } from "vitest";
import {
  isAssistantChromeMessage,
  lastSubstantiveAssistantContent,
  messageCountsTowardAssistantPresence,
} from "./chatMessageUtils";

describe("chatMessageUtils", () => {
  it("treats chrome assistant bubbles as non-substantive", () => {
    expect(isAssistantChromeMessage({ role: "assistant", chatInitGreeting: true })).toBe(
      true,
    );
    expect(
      messageCountsTowardAssistantPresence({
        role: "assistant",
        chatInitGreeting: true,
        content: "Hi",
      }),
    ).toBe(false);
  });

  it("lastSubstantiveAssistantContent skips chrome and empty", () => {
    const messages = [
      { role: "assistant", content: "", personaSwitchNotice: true },
      { role: "user", content: "hello" },
      { role: "assistant", content: "Real reply" },
    ];
    expect(lastSubstantiveAssistantContent(messages)).toBe("Real reply");
  });
});
