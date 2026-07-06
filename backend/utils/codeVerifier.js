const { runAgentTurn, AGENT_PROMPTS } = require('./agents');

async function verifyCommandWithQAAndSupervisor(command, agentName, settings) {
  // 1. QA Engineer review
  const qaSystemPrompt = AGENT_PROMPTS.qa_engineer + `\n\n### Code/Command Execution Safety Audit
You are reviewing a request by agent "${agentName}" to execute the following command:
"${command}"

Please analyze this command for security vulnerabilities, bugs, compliance, and potential system disruptions.
You MUST output your decision using the standard JSON format, placing your evaluation in the "params" object:
{
  "thought": "your step-by-step reasoning",
  "tool": "none",
  "action": "audit",
  "params": {
    "approved": true,
    "can_cause_disruptions": false,
    "reason": "explanation of your safety audit"
  }
}`;

  let qaResult = { approved: true, can_cause_disruptions: false, reason: "No QA analysis available" };
  try {
    const qaTurn = await runAgentTurn('qa_engineer', qaSystemPrompt, settings, `Audit command: ${command}`, []);
    if (qaTurn && qaTurn.params) {
      qaResult = {
        approved: qaTurn.params.approved !== false,
        can_cause_disruptions: qaTurn.params.can_cause_disruptions === true,
        reason: qaTurn.params.reason || qaTurn.thought || "No reason provided"
      };
    }
  } catch (err) {
    console.error('QA verification failed, defaulting to cautious mode:', err);
    qaResult = { approved: false, can_cause_disruptions: true, reason: `QA review failed: ${err.message}` };
  }

  // If QA rejects, do NOT ask the supervisor (Sequential rule)
  if (!qaResult.approved) {
    return {
      qaResult,
      supervisorResult: {
        approved_without_user: false,
        can_cause_disruptions: true,
        reason: "Bypassed - QA did not approve this command execution."
      }
    };
  }

  // 2. Supervisor review (notified of QA approval)
  const supervisorSystemPrompt = AGENT_PROMPTS.supervisor + `\n\n### Supervisor Code Execution Review
Agent "${agentName}" wants to run the command: "${command}".

NOTE: The QA Engineer has already AUDITED and APPROVED this command execution request with the following report:
${JSON.stringify(qaResult)}

Evaluate the command and the QA report.
Determine:
1. Is the command ok to run?
2. Can it cause disruptions? (e.g. commands modifying system configurations, installing/uninstalling packages, deleting files, starting/stopping services, or potential data loss).
If it is completely safe and non-disruptive, set "approved_without_user" to true.
If it can cause disruptions, you MUST set "can_cause_disruptions" to true and "approved_without_user" to false.

You MUST output your decision using the standard JSON format, placing your evaluation in the "params" object:
{
  "thought": "your step-by-step reasoning",
  "tool": "none",
  "action": "evaluate",
  "params": {
    "approved_without_user": true,
    "can_cause_disruptions": false,
    "reason": "explanation of your evaluation"
  }
}`;

  let supervisorResult = { approved_without_user: true, can_cause_disruptions: false, reason: "No Supervisor analysis available" };
  try {
    const supervisorTurn = await runAgentTurn('supervisor', supervisorSystemPrompt, settings, `Verify command and QA report: ${command}`, []);
    if (supervisorTurn && supervisorTurn.params) {
      supervisorResult = {
        approved_without_user: supervisorTurn.params.approved_without_user === true,
        can_cause_disruptions: supervisorTurn.params.can_cause_disruptions === true || supervisorTurn.params.approved_without_user === false,
        reason: supervisorTurn.params.reason || supervisorTurn.thought || "No reason provided"
      };
    }
  } catch (err) {
    console.error('Supervisor verification failed, defaulting to cautious mode:', err);
    supervisorResult = { approved_without_user: false, can_cause_disruptions: true, reason: `Supervisor review failed: ${err.message}` };
  }

  return { qaResult, supervisorResult };
}

async function verifyWriteFileWithQAAndSupervisor(filePath, content, agentName, settings) {
  // 1. QA Engineer review
  const qaSystemPrompt = AGENT_PROMPTS.qa_engineer + `\n\n### Code/File Write Safety Audit
You are reviewing a request by agent "${agentName}" to write the following file:
File Path: "${filePath}"
Content:
${content}

Please analyze this file write for security vulnerabilities, bugs, compliance, and potential system disruptions.
You MUST output your decision using the standard JSON format, placing your evaluation in the "params" object:
{
  "thought": "your step-by-step reasoning",
  "tool": "none",
  "action": "audit",
  "params": {
    "approved": true,
    "can_cause_disruptions": false,
    "reason": "explanation of your safety audit"
  }
}`;

  let qaResult = { approved: true, can_cause_disruptions: false, reason: "No QA analysis available" };
  try {
    const qaTurn = await runAgentTurn('qa_engineer', qaSystemPrompt, settings, `Audit file write at: ${filePath}`, []);
    if (qaTurn && qaTurn.params) {
      qaResult = {
        approved: qaTurn.params.approved !== false,
        can_cause_disruptions: qaTurn.params.can_cause_disruptions === true,
        reason: qaTurn.params.reason || qaTurn.thought || "No reason provided"
      };
    }
  } catch (err) {
    console.error('QA file verification failed, defaulting to cautious mode:', err);
    qaResult = { approved: false, can_cause_disruptions: true, reason: `QA review failed: ${err.message}` };
  }

  // If QA rejects, do NOT ask the supervisor (Sequential rule)
  if (!qaResult.approved) {
    return {
      qaResult,
      supervisorResult: {
        approved_without_user: false,
        can_cause_disruptions: true,
        reason: "Bypassed - QA did not approve this file write."
      }
    };
  }

  // 2. Supervisor review (notified of QA approval)
  const supervisorSystemPrompt = AGENT_PROMPTS.supervisor + `\n\n### Supervisor Code/File Write Review
Agent "${agentName}" wants to write the file: "${filePath}" with the content:
${content}

NOTE: The QA Engineer has already AUDITED and APPROVED this file write request with the following report:
${JSON.stringify(qaResult)}

Evaluate the file write and the QA report.
Determine:
1. Is the file write ok to proceed?
2. Can it cause disruptions? (e.g. overwriting critical files, modifying configurations, introducing insecure code, or potential data loss).
If it is completely safe and non-disruptive, set "approved_without_user" to true.
If it can cause disruptions, you MUST set "can_cause_disruptions" to true and "approved_without_user" to false.

You MUST output your decision using the standard JSON format, placing your evaluation in the "params" object:
{
  "thought": "your step-by-step reasoning",
  "tool": "none",
  "action": "evaluate",
  "params": {
    "approved_without_user": true,
    "can_cause_disruptions": false,
    "reason": "explanation of your evaluation"
  }
}`;

  let supervisorResult = { approved_without_user: true, can_cause_disruptions: false, reason: "No Supervisor analysis available" };
  try {
    const supervisorTurn = await runAgentTurn('supervisor', supervisorSystemPrompt, settings, `Verify file write and QA report for: ${filePath}`, []);
    if (supervisorTurn && supervisorTurn.params) {
      supervisorResult = {
        approved_without_user: supervisorTurn.params.approved_without_user === true,
        can_cause_disruptions: supervisorTurn.params.can_cause_disruptions === true || supervisorTurn.params.approved_without_user === false,
        reason: supervisorTurn.params.reason || supervisorTurn.thought || "No reason provided"
      };
    }
  } catch (err) {
    console.error('Supervisor file verification failed, defaulting to cautious mode:', err);
    supervisorResult = { approved_without_user: false, can_cause_disruptions: true, reason: `Supervisor review failed: ${err.message}` };
  }

  return { qaResult, supervisorResult };
}

module.exports = { verifyCommandWithQAAndSupervisor, verifyWriteFileWithQAAndSupervisor };
