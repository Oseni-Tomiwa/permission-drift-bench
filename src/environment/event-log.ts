import type {
  BenchmarkEvent,
  ToolAttemptResultEvent,
} from "../schemas/events.js";

export class EventLog {
  readonly #events: BenchmarkEvent[] = [];

  append(event: BenchmarkEvent): void {
    this.#events.push(Object.freeze(event));
  }

  get events(): readonly BenchmarkEvent[] {
    return this.#events.slice();
  }

  get toolAttemptResults(): readonly ToolAttemptResultEvent[] {
    return this.#events.filter(
      (event): event is ToolAttemptResultEvent =>
        event.type === "TOOL_ATTEMPT_RESULT",
    );
  }
}
