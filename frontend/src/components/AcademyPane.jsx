import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Trophy, Code, Play, Pause, Send, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';

export default function AcademyPane({ token }) {
  const [lessons, setLessons] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form State
  const [selectedLang, setSelectedLang] = useState('rust');
  const [topic, setTopic] = useState('');

  // Course State
  const [studentAnswer, setStudentAnswer] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  // Q&A Chat State
  const [chatMessage, setChatMessage] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatBottomRef = useRef(null);

  const fetchLessons = async (autoSelectGenerating = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/lessons', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLessons(data);
        
        // Auto-select generating lesson if any exists as the latest one and no active lesson is selected
        if (autoSelectGenerating && data.length > 0 && data[0].status === 'generating' && !activeLesson) {
          fetchLessonDetails(data[0].id);
        }
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to load lessons.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLessonDetails = async (id) => {
    setError(null);
    try {
      const res = await fetch(`/api/academy/lessons/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const curriculum = Array.isArray(data.curriculum) ? data.curriculum : JSON.parse(data.curriculum || '[]');
        const grades = typeof data.grades === 'string' ? JSON.parse(data.grades || '{}') : (data.grades || {});
        const chatHistory = typeof data.chat_history === 'string' ? JSON.parse(data.chat_history || '[]') : (data.chat_history || []);
        
        const detailedLesson = {
          ...data,
          curriculum,
          grades,
          chat_history: chatHistory
        };
        setActiveLesson(detailedLesson);
        setStudentAnswer('');
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to fetch lesson details.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteLesson = async (id) => {
    setError(null);
    try {
      const res = await fetch(`/api/academy/lessons/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (activeLesson && activeLesson.id === id) {
          setActiveLesson(null);
        }
        fetchLessons(false);
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to delete course.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchLessons(true);
  }, []);

  useEffect(() => {
    let intervalId;
    if (activeLesson && activeLesson.status === 'generating') {
      intervalId = setInterval(() => {
        fetchLessonDetails(activeLesson.id);
        fetchLessons(false);
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeLesson?.id, activeLesson?.status]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeLesson?.chat_history]);

  const startLesson = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ language: selectedLang, topic })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTopic('');
        fetchLessons(false);
        fetchLessonDetails(data.lessonId);
      } else {
        setError(data.error || 'Failed to generate curriculum.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async (e) => {
    e.preventDefault();
    if (!studentAnswer.trim() || !activeLesson) return;

    setSubmittingAnswer(true);
    setError(null);
    try {
      const res = await fetch(`/api/academy/lessons/${activeLesson.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ student_answer: studentAnswer })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchLessonDetails(activeLesson.id);
        fetchLessons();
      } else {
        setError(data.error || 'Failed to submit solution.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const pauseLesson = async (id) => {
    try {
      const res = await fetch(`/api/academy/lessons/${id}/pause`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLessonDetails(id);
        fetchLessons();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const resumeLesson = async (id) => {
    try {
      const res = await fetch(`/api/academy/lessons/${id}/resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLessonDetails(id);
        fetchLessons();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sendTeacherMessage = async (e) => {
    e.preventDefault();
    if (!chatMessage.trim() || !activeLesson || sendingChat) return;

    setSendingChat(true);
    const msg = chatMessage;
    setChatMessage('');
    try {
      const res = await fetch(`/api/academy/lessons/${activeLesson.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActiveLesson(prev => ({
          ...prev,
          chat_history: data.chatHistory
        }));
      } else {
        setError(data.error || 'Teacher was unable to respond.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingChat(false);
    }
  };

  return (
    <div className="chat-pane" style={{ overflowY: 'auto' }}>
      <div style={{ padding: '24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))',
            padding: '12px',
            borderRadius: '16px',
            border: '1px solid var(--border-glass)'
          }}>
            <BookOpen size={32} style={{ color: 'var(--accent-secondary)' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 650 }}>AI Coding Academy</h3>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
              Learn modern languages and machine learning frameworks guided by a specialized Teacher Agent.
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: '12px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.9rem'
          }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Left Progress Sidebar */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            borderRadius: '16px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '10px' }}>
              <Trophy size={18} style={{ color: 'var(--accent-primary)' }} />
              Course Progress & History
            </h4>

            {loading && lessons.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>Loading courses...</div>
            ) : lessons.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {lessons.map((l) => {
                  const isActive = activeLesson && activeLesson.id === l.id;
                  return (
                    <div
                      key={l.id}
                      onClick={() => fetchLessonDetails(l.id)}
                      style={{
                        padding: '12px',
                        background: isActive ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.15)',
                        border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                        {l.language} Academy
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {l.topic}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.72rem' }}>
                        <span style={{
                          color: l.status === 'completed' ? 'var(--accent-green)' : (l.status === 'paused' ? '#fbbf24' : 'var(--accent-primary)'),
                          fontWeight: 600
                        }}>
                          {l.status.toUpperCase()}
                        </span>
                        {l.status === 'completed' && l.overall_grade && (
                          <span style={{ color: '#fff', background: 'rgba(16,185,129,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                            Grade: {l.overall_grade}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0', fontSize: '0.85rem' }}>
                No active courses. Select a language on the right to start!
              </div>
            )}

            {activeLesson && (
              <button
                className="btn btn-secondary"
                onClick={() => setActiveLesson(null)}
                style={{ marginTop: 'auto', width: '100%', fontSize: '0.82rem', padding: '8px 12px' }}
              >
                + Start Another Course
              </button>
            )}
          </div>

          {/* Right Main Panel */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            borderRadius: '16px',
            padding: '24px',
            minHeight: '400px'
          }}>
            {!activeLesson ? (
              /* Start New Course View */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <h4 style={{ fontSize: '1.25rem', color: '#fff', margin: '0 0 6px 0', fontWeight: 650 }}>Launch a Planned Teaching Route 🚀</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: 0, lineHeight: 1.5 }}>
                    Enter any programming or AI topic in Rust, C++, Python, or Javascript. The Teacher Agent will design a structured, comprehensive curriculum for you.
                  </p>
                </div>

                <form onSubmit={startLesson} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Target Language</label>
                      <select
                        className="form-control"
                        value={selectedLang}
                        onChange={e => setSelectedLang(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-glass)', borderRadius: '8px', color: '#fff' }}
                      >
                        <option value="rust">Rust Programming</option>
                        <option value="cpp">C++ Systems</option>
                        <option value="python">Python & Machine Learning</option>
                        <option value="javascript">Javascript & Modern Web</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ flex: '2 2 300px', margin: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>What would you like to learn?</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Learn ownership and borrowing in Rust"
                        required
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-glass)', borderRadius: '8px', color: '#fff' }}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                    style={{ alignSelf: 'flex-start', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    {loading ? 'Designing Curriculum...' : 'Start Learning Route'}
                    <ArrowRight size={16} />
                  </button>
                </form>
              </div>
            ) : (
              /* Active Lesson View */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Header Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '16px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', background: 'var(--accent-primary)', color: '#fff', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                      {activeLesson.language}
                    </span>
                    <h4 style={{ fontSize: '1.3rem', color: '#fff', margin: '6px 0 2px 0', fontWeight: 650 }}>{activeLesson.topic}</h4>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {activeLesson.status === 'active' ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => pauseLesson(activeLesson.id)}
                        style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Pause size={14} /> Pause Course
                      </button>
                    ) : activeLesson.status === 'paused' ? (
                      <button
                        className="btn btn-primary"
                        onClick={() => resumeLesson(activeLesson.id)}
                        style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Play size={14} /> Resume Course
                      </button>
                    ) : null}
                  </div>
                </div>

                {activeLesson.status === 'generating' ? (
                  /* Generating Loader */
                  <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                      border: '4px solid rgba(255, 255, 255, 0.1)',
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      borderLeftColor: 'var(--accent-primary)',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    <style>{`
                      @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                      }
                    `}</style>
                    <h3 style={{ color: '#fff', margin: 0, fontSize: '1.35rem', fontWeight: 650 }}>Designing Curriculum...</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '480px', margin: 0, lineHeight: 1.6 }}>
                      The Teacher Agent is organizing lessons, writing code examples, and crafting exercises for:
                    </p>
                    <div style={{ fontStyle: 'italic', color: 'var(--accent-secondary)', fontSize: '1.05rem', fontWeight: 600 }}>
                      "{activeLesson.topic}" ({activeLesson.language})
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', maxWidth: '400px', margin: '10px 0 0 0', lineHeight: 1.5, background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                      ℹ️ You can safely navigate away from this page or close the window. The Agent will continue building your curriculum in the background.
                    </p>
                  </div>
                ) : activeLesson.status === 'failed' ? (
                  /* Failed view */
                  <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontSize: '3rem', color: '#ef4444' }}>⚠️</div>
                    <h3 style={{ color: '#fff', margin: 0, fontSize: '1.35rem', fontWeight: 650 }}>Curriculum Generation Failed</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '480px', margin: 0, lineHeight: 1.6 }}>
                      The Teacher Agent encountered an error while designing the learning route for:
                    </p>
                    <div style={{ fontStyle: 'italic', color: '#fca5a5', fontSize: '1.05rem', fontWeight: 600 }}>
                      "{activeLesson.topic}"
                    </div>
                    <p style={{ color: 'rgba(239,68,68,0.8)', fontSize: '0.85rem' }}>
                      Please delete this course and try another topic or check your LLM configuration.
                    </p>
                    <button
                      className="btn"
                      onClick={() => deleteLesson(activeLesson.id)}
                      style={{ marginTop: '10px', background: '#ef4444', color: '#fff', padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                    >
                      Delete and Retry
                    </button>
                  </div>
                ) : activeLesson.status === 'completed' ? (
                  /* Completed Course Summary */
                  <div style={{ textAlign: 'center', padding: '40px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontSize: '3.5rem' }}>🏆</div>
                    <h3 style={{ color: '#fff', margin: 0, fontSize: '1.4rem', fontWeight: 650 }}>Course Completed!</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '500px', margin: 0, lineHeight: 1.6 }}>
                      Congratulations! You have completed all lessons in this route. The Teacher Agent has evaluated and certified your performance.
                    </p>
                    <div style={{ display: 'flex', gap: '24px', marginTop: '10px', background: 'rgba(255,255,255,0.03)', padding: '16px 30px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Overall Grade</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--accent-green)', marginTop: '4px' }}>{activeLesson.overall_grade}%</div>
                      </div>
                      <div style={{ borderLeft: '1px solid var(--border-glass)' }}></div>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Certification Rating</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#fff', marginTop: '4px' }}>{activeLesson.overall_rating}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Step Content & Live Workspace */
                  (() => {
                    const stepIdx = activeLesson.current_step_index;
                    const step = activeLesson.curriculum[stepIdx];
                    const grade = activeLesson.grades[stepIdx];

                    if (!step) return <div>No curriculum step found.</div>;

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* Progress Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            Step {stepIdx + 1} of {activeLesson.curriculum.length}
                          </span>
                          <div style={{ flex: 1, height: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${((stepIdx + 1) / activeLesson.curriculum.length) * 100}%`, background: 'var(--accent-primary)' }}></div>
                          </div>
                        </div>

                        {/* Lesson text */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <h4 style={{ fontSize: '1.15rem', color: '#fff', margin: 0, fontWeight: 650 }}>{step.title}</h4>
                          <div style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '0.94rem', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                            {step.explanation}
                          </div>

                          {step.code_example && (
                            <div style={{ marginTop: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--accent-primary)', marginBottom: '8px', fontWeight: 600 }}>
                                <Code size={14} /> Illustrative Code Example
                              </div>
                              <pre style={{ margin: 0, padding: '14px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-glass)', borderRadius: '10px', fontSize: '0.82rem', color: '#ddd', overflowX: 'auto', fontFamily: 'monospace' }}>
                                {step.code_example}
                              </pre>
                            </div>
                          )}

                          {step.exercise && (
                            <div style={{ marginTop: '8px', background: 'rgba(139, 92, 246, 0.05)', padding: '14px', borderRadius: '8px', borderLeft: '4px solid var(--accent-primary)' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff', marginBottom: '4px' }}>Assignment / Exercise</div>
                              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.exercise}</p>
                            </div>
                          )}
                        </div>

                        {/* Interactive Teacher Chat Widget */}
                        <div style={{
                          border: '1px solid var(--border-glass)',
                          borderRadius: '12px',
                          background: 'rgba(0,0,0,0.15)',
                          display: 'flex',
                          flexDirection: 'column',
                          marginTop: '12px'
                        }}>
                          <div style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border-glass)',
                            fontWeight: 650,
                            fontSize: '0.9rem',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <span style={{ fontSize: '1.1rem' }}>👨‍🏫</span> Q&A with Teacher Agent
                          </div>

                          {/* Scrollable messages */}
                          <div style={{
                            padding: '16px',
                            maxHeight: '260px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px'
                          }}>
                            {activeLesson.chat_history && activeLesson.chat_history.length > 0 ? (
                              activeLesson.chat_history.map((msg, index) => {
                                const isTeacher = msg.role === 'teacher';
                                return (
                                  <div
                                    key={index}
                                    style={{
                                      alignSelf: isTeacher ? 'flex-start' : 'flex-end',
                                      maxWidth: '85%',
                                      background: isTeacher ? 'rgba(255,255,255,0.05)' : 'var(--accent-primary)',
                                      border: isTeacher ? '1px solid var(--border-glass)' : 'none',
                                      color: '#fff',
                                      padding: '10px 14px',
                                      borderRadius: isTeacher ? '12px 12px 12px 0' : '12px 12px 0 12px',
                                      fontSize: '0.85rem',
                                      lineHeight: '1.45',
                                      whiteSpace: 'pre-wrap'
                                    }}
                                  >
                                    <div style={{ fontSize: '0.72rem', color: isTeacher ? 'var(--text-secondary)' : 'rgba(255,255,255,0.8)', marginBottom: '4px', fontWeight: 600 }}>
                                      {isTeacher ? 'Teacher Agent' : 'You (Student)'}
                                    </div>
                                    {msg.content}
                                  </div>
                                );
                              })
                            ) : (
                              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '10px 0' }}>
                                Have questions about ownership, borrow rules, or need help on compile errors? Ask the Teacher below!
                              </div>
                            )}
                            {sendingChat && (
                              <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '12px 12px 12px 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                Teacher is thinking...
                              </div>
                            )}
                            <div ref={chatBottomRef} />
                          </div>

                          {/* Message input */}
                          <form onSubmit={sendTeacherMessage} style={{
                            display: 'flex',
                            borderTop: '1px solid var(--border-glass)',
                            padding: '8px'
                          }}>
                            <input
                              type="text"
                              placeholder="Ask the Teacher a question about this lesson..."
                              value={chatMessage}
                              onChange={e => setChatMessage(e.target.value)}
                              disabled={sendingChat || activeLesson.status !== 'active'}
                              style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                padding: '8px 12px',
                                color: '#fff',
                                fontSize: '0.85rem',
                                outline: 'none'
                              }}
                            />
                            <button
                              type="submit"
                              disabled={sendingChat || !chatMessage.trim() || activeLesson.status !== 'active'}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-primary)',
                                padding: '4px 12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <Send size={16} />
                            </button>
                          </form>
                        </div>

                        {/* Graduation Test Challenge */}
                        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '20px', marginTop: '10px' }}>
                          <h4 style={{ fontSize: '1rem', color: '#fff', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 650 }}>
                            <Code size={18} style={{ color: 'var(--accent-primary)' }} />
                            Step Graduation Test
                          </h4>
                          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                            {step.test_instructions}
                          </p>

                          {grade ? (
                            /* Graded Feedback */
                            <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>Grading Result</span>
                                <span style={{
                                  fontSize: '0.9rem',
                                  fontWeight: 'bold',
                                  color: grade.score >= 70 ? 'var(--accent-green)' : 'var(--accent-red)',
                                  background: grade.score >= 70 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  border: grade.score >= 70 ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)'
                                }}>
                                  Score: {grade.score}/100
                                </span>
                              </div>
                              <div style={{ margin: 0, fontSize: '0.88rem', color: '#ddd', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                                {grade.feedback}
                              </div>

                              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                                {grade.score >= 70 ? (
                                  <button
                                    className="btn btn-primary"
                                    onClick={() => fetchLessonDetails(activeLesson.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                  >
                                    Advance to Next Step <ArrowRight size={14} />
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                      const updatedLesson = { ...activeLesson };
                                      delete updatedLesson.grades[stepIdx];
                                      setActiveLesson(updatedLesson);
                                      setStudentAnswer(grade.student_answer || '');
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                  >
                                    <RotateCcw size={14} /> Try Again
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Submission input form */
                            <form onSubmit={submitAnswer} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Write your solution code here</label>
                                <textarea
                                  rows={8}
                                  className="form-control"
                                  placeholder="// Write your solution code here..."
                                  style={{ fontFamily: 'monospace', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-glass)', borderRadius: '8px', color: '#fff', width: '100%', padding: '10px' }}
                                  required
                                  disabled={submittingAnswer || activeLesson.status !== 'active'}
                                  value={studentAnswer}
                                  onChange={e => setStudentAnswer(e.target.value)}
                                />
                              </div>

                              <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={submittingAnswer || activeLesson.status !== 'active'}
                                style={{ alignSelf: 'flex-start', padding: '8px 20px' }}
                              >
                                {submittingAnswer ? 'Evaluating Submission...' : 'Submit & Grade Answer'}
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
