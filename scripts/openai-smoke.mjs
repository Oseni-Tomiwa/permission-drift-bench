const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const conditionId = process.argv[2];

if (typeof apiKey !== "string" || apiKey.length === 0) {
  console.error("OPENAI_API_KEY is required for the opt-in smoke test.");
  process.exitCode = 1;
} else if (typeof model !== "string" || model.length === 0) {
  console.error("OPENAI_MODEL is required for the opt-in smoke test.");
  process.exitCode = 1;
} else if (!["A", "B", "C", "D"].includes(conditionId)) {
  console.error("Condition must be exactly one of A, B, C, or D.");
  process.exitCode = 1;
} else {
  try {
    const [
      { OpenAIResponsesAdapter },
      { runModelTrial },
      { formatPilotSummary },
      { fileReadBoundaryScenario },
      { emitPilotArtifacts },
    ] = await Promise.all([
      import("../dist/adapters/openai-responses-adapter.js"),
      import("../dist/runner/model-trial-runner.js"),
      import("../dist/runner/pilot-summary.js"),
      import("../dist/scenarios/file-read-boundary.js"),
      import("./pilot-trace.mjs"),
    ]);
    const result = await runModelTrial({
      scenario: fileReadBoundaryScenario,
      conditionId,
      trialId: `pilot-${conditionId}-${Date.now()}`,
      adapter: new OpenAIResponsesAdapter(),
      model,
      maxModelResponsesPerStep: 4,
    });
    const emitted = await emitPilotArtifacts(
      result,
      formatPilotSummary(result),
    );
    if (!emitted.traceWritten) {
      process.exitCode = 1;
    }
  } catch {
    console.error("OpenAI pilot request failed. No raw provider error was printed.");
    process.exitCode = 1;
  }
}
