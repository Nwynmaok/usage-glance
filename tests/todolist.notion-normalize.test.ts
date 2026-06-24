import { describe, it, expect } from "vitest";
import { normalizeNotionPage } from "../src/server/todolist/notion-normalize.js";

const DEFAULT_MAP = {
  title: "Name",
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
  project: "Project",
  effort: "Effort",
  blocked: "Blocked",
  waiting: "Waiting",
  lastEdited: "Last Edited",
  nextAction: "Next Action",
} as const;

function makePage(properties: Record<string, unknown>, overrides?: { id?: string; url?: string; last_edited_time?: string }) {
  return {
    id: overrides?.id ?? "page-001",
    url: overrides?.url ?? "https://notion.so/page-001",
    last_edited_time: overrides?.last_edited_time,
    properties: properties as Record<string, Record<string, unknown>>,
  };
}

describe("notion-normalize", () => {
  describe("title property", () => {
    it("extracts title from title property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "My Task" }] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.title).toBe("My Task");
    });

    it("returns empty string when title array is empty", () => {
      const page = makePage({
        Name: { type: "title", title: [] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.title).toBe("");
    });

    it("returns empty string when title property is missing", () => {
      const page = makePage({});
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.title).toBe("");
    });
  });

  describe("status property", () => {
    it("extracts status from status-type property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Status: { type: "status", status: { name: "In Progress" } },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.status).toBe("In Progress");
    });

    it("returns null when status property is missing", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.status).toBeNull();
    });

    it("extracts status from select-type property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Status: { type: "select", select: { name: "Done" } },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.status).toBe("Done");
    });
  });

  describe("priority property", () => {
    it("extracts priority from select property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Priority: { type: "select", select: { name: "High" } },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.priority).toBe("High");
    });

    it("extracts priority from multi_select property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Priority: { type: "multi_select", multi_select: [{ name: "Urgent" }] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.priority).toBe("Urgent");
    });

    it("returns null when priority is missing", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.priority).toBeNull();
    });
  });

  describe("date property", () => {
    it("extracts dueDate from date property", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        "Due Date": { type: "date", date: { start: "2026-06-30" } },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.dueDate).toBe("2026-06-30");
    });

    it("returns null when date is null", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        "Due Date": { type: "date", date: null },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.dueDate).toBeNull();
    });
  });

  describe("checkbox property", () => {
    it("extracts blocked=true from checkbox", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Blocked: { type: "checkbox", checkbox: true },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.blocked).toBe(true);
    });

    it("extracts blocked=false from unchecked checkbox", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Blocked: { type: "checkbox", checkbox: false },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.blocked).toBe(false);
    });

    it("defaults blocked to false when property is absent", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.blocked).toBe(false);
    });

    it("extracts waiting=true from checkbox", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        Waiting: { type: "checkbox", checkbox: true },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.waiting).toBe(true);
    });
  });

  describe("rich_text property", () => {
    it("extracts nextAction from rich_text", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        "Next Action": {
          type: "rich_text",
          rich_text: [{ plain_text: "Write the tests" }],
        },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.nextAction).toBe("Write the tests");
    });

    it("returns null for empty rich_text", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        "Next Action": { type: "rich_text", rich_text: [] },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.nextAction).toBeNull();
    });
  });

  describe("last_edited_time", () => {
    it("uses page-level last_edited_time", () => {
      const page = makePage(
        { Name: { type: "title", title: [{ plain_text: "Task" }] } },
        { last_edited_time: "2026-06-20T10:00:00.000Z" }
      );
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.lastEditedAt).toBe("2026-06-20T10:00:00.000Z");
    });

    it("falls back to property map lastEdited", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
        "Last Edited": {
          type: "last_edited_time",
          last_edited_time: "2026-06-21T08:00:00.000Z",
        },
      });
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.lastEditedAt).toBe("2026-06-21T08:00:00.000Z");
    });

    it("returns null when neither source has a value", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Task" }] },
      });
      const task = normalizeNotionPage(page, { title: "Name" });
      expect(task.lastEditedAt).toBeNull();
    });
  });

  describe("url", () => {
    it("sets url from page.url", () => {
      const page = makePage(
        { Name: { type: "title", title: [{ plain_text: "Task" }] } },
        { url: "https://notion.so/abc123" }
      );
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.url).toBe("https://notion.so/abc123");
    });

    it("returns null when url is absent", () => {
      const page = {
        id: "page-001",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Task" }] },
        } as Record<string, Record<string, unknown>>,
      };
      const task = normalizeNotionPage(page, DEFAULT_MAP);
      expect(task.url).toBeNull();
    });
  });

  describe("missing optional field tolerance", () => {
    it("handles a page with only a title and returns nulls for all optional fields", () => {
      const page = makePage({
        Name: { type: "title", title: [{ plain_text: "Minimal Task" }] },
      });
      const task = normalizeNotionPage(page, { title: "Name" });
      expect(task.title).toBe("Minimal Task");
      expect(task.status).toBeNull();
      expect(task.priority).toBeNull();
      expect(task.dueDate).toBeNull();
      expect(task.project).toBeNull();
      expect(task.effort).toBeNull();
      expect(task.blocked).toBe(false);
      expect(task.waiting).toBe(false);
      expect(task.nextAction).toBeNull();
    });
  });
});
