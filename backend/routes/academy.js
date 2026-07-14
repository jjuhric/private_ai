const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');
const { runWorkerAgent } = require('../utils/agents');
const logger = require('../utils/logger');

const { decrypt } = require('../utils/crypto');

function extractWorkerOutput(rawOutput) {
  if (!rawOutput) return '';
  const trimmed = rawOutput.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && (parsed.status === 'success' || parsed.status === 'error')) {
      if (parsed.data && typeof parsed.data === 'object' && Object.keys(parsed.data).length > 0) {
        return JSON.stringify(parsed.data);
      }
      if (parsed.data && typeof parsed.data === 'string' && parsed.data.trim().length > 0) {
        return parsed.data;
      }
      if (parsed.summary && typeof parsed.summary === 'string') {
        const s = parsed.summary.trim();
        let cleanS = s;
        if (cleanS.startsWith('```')) {
          cleanS = cleanS.replace(/^```(json)?\n/, '').replace(/\n```$/, '').trim();
        }
        if (cleanS.startsWith('{') || cleanS.startsWith('[')) {
          return cleanS;
        }
      }
      if (parsed.summary) {
        return parsed.summary;
      }
      return JSON.stringify(parsed.data || {});
    }
    return trimmed;
  } catch (e) {
    return trimmed;
  }
}

function cleanAndRepairJSON(str) {
  if (!str) return '';
  let result = '';
  let insideString = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (char === '\\') {
      result += char;
      if (i + 1 < str.length) {
        result += str[i + 1];
        i++;
      }
      continue;
    }
    
    if (char === '"') {
      if (!insideString) {
        insideString = true;
        result += char;
      } else {
        let isEnd = false;
        let j = i + 1;
        while (j < str.length) {
          const nextChar = str[j];
          if (nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r') {
            j++;
            continue;
          }
          if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']') {
            isEnd = true;
          }
          break;
        }
        
        if (isEnd) {
          insideString = false;
          result += char;
        } else {
          result += '\\"';
        }
      }
      continue;
    }
    
    if (insideString && (char === '\n' || char === '\r')) {
      if (char === '\n') {
        result += '\\n';
      }
      continue;
    }
    
    result += char;
  }
  
  result = result.replace(/,\s*([\]}])/g, '$1');
  return result;
}

// Start a new lesson (asynchronously in background)
router.post('/start', authenticateToken, async (req, res) => {
  const { language, topic } = req.body;
  if (!language || !topic) {
    return res.status(400).json({ error: 'language and topic are required' });
  }

  try {
    const db = await getDb();
    
    // Load settings for LLM execution
    const dbSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    if (!dbSettings) {
      return res.status(400).json({ error: 'User settings not configured.' });
    }

    const settings = {
      provider: dbSettings.provider,
      modelName: dbSettings.preferred_online_model || dbSettings.model_name,
      onlineProvider: dbSettings.online_provider,
      onlineKey: decrypt(dbSettings.online_key),
      geminiKey: decrypt(dbSettings.gemini_key),
      localBaseUrl: dbSettings.local_url,
      localApiKey: decrypt(dbSettings.local_key),
      localApiStyle: dbSettings.local_api_style,
      onlineUrl: dbSettings.online_url,
      workingDirectory: dbSettings.working_directory,
      db,
      userId: req.user.id
    };

    logger.info(`[Academy] Pre-registering generating lesson for ${language} - ${topic}...`);

    // Insert initial generating record
    const result = await db.run(
      'INSERT INTO academy_lessons (user_id, language, topic, curriculum, current_step_index, status, grades) VALUES (?, ?, ?, "[]", 0, "generating", "{}")',
      [req.user.id, language, topic]
    );

    const lessonId = result.lastID;

    // Trigger AI curriculum generation in the background
    const promptTask = `Action: "generate_curriculum"
Language: "${language}"
Topic: "${topic}"`;

    (async () => {
      try {
        logger.info(`[Academy Background Worker] Generating curriculum for lesson ${lessonId}...`);
        const resultText = await runWorkerAgent('teacher_agent', settings, promptTask, db, req.user.id);
        
        let cleanedText = extractWorkerOutput(resultText);
        if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }

        const repaired = cleanAndRepairJSON(cleanedText);
        let parsed;
        try {
          parsed = JSON.parse(repaired);
        } catch (jsonErr) {
          throw new Error(`${jsonErr.message}\nRaw Cleaned Text: ${cleanedText}\nRepaired Text: ${repaired}`);
        }
        const curriculumData = parsed.curriculum;
        if (!Array.isArray(curriculumData) || curriculumData.length === 0) {
          throw new Error('Curriculum must be a non-empty array.');
        }

        await db.run(
          'UPDATE academy_lessons SET curriculum = ?, status = "active", updated_at = datetime("now") WHERE id = ?',
          [JSON.stringify(curriculumData), lessonId]
        );
        logger.info(`[Academy Background Worker] Curriculum generated successfully for lesson ${lessonId}`);
      } catch (err) {
        logger.error(`[Academy Background Worker] Failed to generate curriculum for lesson ${lessonId}: ${err.message}`);
        await db.run(
          'UPDATE academy_lessons SET status = "failed", updated_at = datetime("now") WHERE id = ?',
          [lessonId]
        );
      }
    })();

    res.json({
      success: true,
      lessonId,
      language,
      topic,
      status: 'generating',
      curriculum: []
    });

  } catch (err) {
    logger.error('[Academy] Error starting lesson: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// List all lessons
router.get('/lessons', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT id, language, topic, current_step_index, status, overall_rating, overall_grade, created_at, updated_at FROM academy_lessons WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single lesson's full details
router.get('/lessons/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT * FROM academy_lessons WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!row) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    
    // Parse JSON fields
    row.curriculum = JSON.parse(row.curriculum);
    row.grades = JSON.parse(row.grades);
    
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause a lesson
router.post('/lessons/:id/pause', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'UPDATE academy_lessons SET status = "paused", updated_at = datetime("now") WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: 'Lesson paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume a lesson
router.post('/lessons/:id/resume', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'UPDATE academy_lessons SET status = "active", updated_at = datetime("now") WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: 'Lesson resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit code answer for the current step
router.post('/lessons/:id/submit', authenticateToken, async (req, res) => {
  const { student_answer } = req.body;
  if (!student_answer) {
    return res.status(400).json({ error: 'student_answer is required' });
  }

  try {
    const db = await getDb();
    const lesson = await db.get(
      'SELECT * FROM academy_lessons WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (lesson.status === 'completed') {
      return res.status(400).json({ error: 'Lesson is already completed.' });
    }

    const curriculum = JSON.parse(lesson.curriculum);
    const stepIdx = lesson.current_step_index;
    const currentStep = curriculum[stepIdx];

    if (!currentStep) {
      return res.status(400).json({ error: 'Invalid step state.' });
    }

    // Fetch latest research updates for this language
    const updatesRow = await db.get(
      'SELECT update_summary, breaking_changes FROM coding_language_updates WHERE language = ? ORDER BY query_date DESC LIMIT 1',
      [lesson.language.toLowerCase()]
    );

    const breakingChangesText = updatesRow ? updatesRow.breaking_changes : '[]';

    // Load settings for LLM execution
    const dbSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    const settings = {
      provider: dbSettings.provider,
      modelName: dbSettings.preferred_online_model || dbSettings.model_name,
      onlineProvider: dbSettings.online_provider,
      onlineKey: decrypt(dbSettings.online_key),
      geminiKey: decrypt(dbSettings.gemini_key),
      localBaseUrl: dbSettings.local_url,
      localApiKey: decrypt(dbSettings.local_key),
      localApiStyle: dbSettings.local_api_style,
      onlineUrl: dbSettings.online_url,
      workingDirectory: dbSettings.working_directory,
      db,
      userId: req.user.id
    };

    logger.info(`[Academy] Grading submission for step ${stepIdx} in ${lesson.language}...`);

    const promptTask = `Action: "grade_answer"
Language: "${lesson.language}"
Lesson Title: "${currentStep.title}"
Lesson Explanation: "${currentStep.explanation}"
Code Example: "${currentStep.code_example}"
Test Instructions: "${currentStep.test_instructions}"
Student Answer: "${student_answer}"
Language Updates/Breaking Changes: ${breakingChangesText}`;

    const gradingResult = await runWorkerAgent('teacher_agent', settings, promptTask, db, req.user.id);

    let cleanedText = extractWorkerOutput(gradingResult);
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
    }

    let gradeData;
    try {
      const repaired = cleanAndRepairJSON(cleanedText);
      gradeData = JSON.parse(repaired);
    } catch (e) {
      logger.error('[Academy] Failed to parse grading response: ' + e.message + '\nRaw Output: ' + gradingResult);
      return res.status(500).json({ error: 'AI failed to grade your answer. Please resubmit.' });
    }

    // Update grades in DB
    const grades = JSON.parse(lesson.grades || '{}');
    grades[stepIdx] = {
      score: gradeData.score || 0,
      feedback: gradeData.feedback || 'No feedback provided.',
      student_answer
    };

    let nextStepIdx = stepIdx;
    let nextStatus = lesson.status;
    let overallRating = lesson.overall_rating;
    let overallGrade = lesson.overall_grade;

    if (gradeData.is_correct) {
      nextStepIdx += 1;
      
      // If we finished the last step, mark as completed
      if (nextStepIdx >= curriculum.length) {
        nextStatus = 'completed';
        
        // Calculate average grade
        const scores = Object.values(grades).map(g => g.score);
        const total = scores.reduce((sum, val) => sum + val, 0);
        overallGrade = scores.length > 0 ? parseFloat((total / scores.length).toFixed(1)) : 0;
        
        // Determine overall rating
        if (overallGrade >= 90) overallRating = 'Outstanding (A+)';
        else if (overallGrade >= 80) overallRating = 'Excellent (A)';
        else if (overallGrade >= 70) overallRating = 'Competent (B)';
        else if (overallGrade >= 50) overallRating = 'Passing (C)';
        else overallRating = 'Needs Improvement (F)';
      }
    }

    await db.run(
      'UPDATE academy_lessons SET current_step_index = ?, status = ?, grades = ?, overall_rating = ?, overall_grade = ?, updated_at = datetime("now") WHERE id = ?',
      [nextStepIdx, nextStatus, JSON.stringify(grades), overallRating, overallGrade, lesson.id]
    );

    res.json({
      success: true,
      grade: gradeData,
      currentStepIndex: nextStepIdx,
      status: nextStatus,
      overallRating,
      overallGrade
    });

  } catch (err) {
    logger.error('[Academy] Error grading submission: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/academy/lessons/:id/chat: Q&A discussion with the Teacher
router.post('/lessons/:id/chat', authenticateToken, async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const db = await getDb();
    const lesson = await db.get(
      'SELECT * FROM academy_lessons WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const curriculum = JSON.parse(lesson.curriculum);
    const stepIdx = lesson.current_step_index;
    const currentStep = curriculum[stepIdx] || {};
    const chatHistory = JSON.parse(lesson.chat_history || '[]');

    // Load settings for LLM execution
    const dbSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    const settings = {
      provider: dbSettings.provider,
      modelName: dbSettings.preferred_online_model || dbSettings.model_name,
      onlineProvider: dbSettings.online_provider,
      onlineKey: decrypt(dbSettings.online_key),
      geminiKey: decrypt(dbSettings.gemini_key),
      localBaseUrl: dbSettings.local_url,
      localApiKey: decrypt(dbSettings.local_key),
      localApiStyle: dbSettings.local_api_style,
      onlineUrl: dbSettings.online_url,
      workingDirectory: dbSettings.working_directory,
      db,
      userId: req.user.id
    };

    logger.info(`[Academy] Chat turn with Teacher for lesson ${lesson.id}...`);

    const promptTask = `Action: "discuss_lesson"
Language: "${lesson.language}"
Lesson Title: "${currentStep.title || 'Introduction'}"
Lesson Explanation: "${currentStep.explanation || ''}"
Code Example: "${currentStep.code_example || ''}"
Test Instructions: "${currentStep.test_instructions || ''}"
Student Message: "${message}"
Discussion History: ${JSON.stringify(chatHistory)}`;

    const responseText = await runWorkerAgent('teacher_agent', settings, promptTask, db, req.user.id);

    let cleanedText = extractWorkerOutput(responseText);
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
    }

    let discussData;
    try {
      const repaired = cleanAndRepairJSON(cleanedText);
      discussData = JSON.parse(repaired);
    } catch (e) {
      logger.error('[Academy] Failed to parse Teacher discussion response: ' + e.message + '\nRaw Output: ' + responseText);
      return res.status(500).json({ error: 'AI failed to reply. Please try again.' });
    }

    // Append to chat history
    chatHistory.push({ role: 'student', content: message, created_at: new Date().toISOString() });
    chatHistory.push({ role: 'teacher', content: discussData.reply || 'Let me think about that.', created_at: new Date().toISOString() });

    await db.run(
      'UPDATE academy_lessons SET chat_history = ?, updated_at = datetime("now") WHERE id = ?',
      [JSON.stringify(chatHistory), lesson.id]
    );

    res.json({
      success: true,
      reply: discussData.reply,
      chatHistory
    });

  } catch (err) {
    logger.error('[Academy] Error in Teacher Q&A: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a lesson
router.delete('/lessons/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'DELETE FROM academy_lessons WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
