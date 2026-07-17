import React, { useState } from 'react';
import { X, Wand2, ChevronLeft, ChevronRight, CheckCircle, Sliders, BookOpen } from 'lucide-react';
import { wizardTemplates, composeMarkdown } from '../data/wizardTemplates';

export default function SkillWizardModal({ isOpen, onClose, token, onSaved, initialType = 'skill' }) {
  const [step, setStep] = useState(1); // 1: type, 2: template, 3: fields, 4: preview
  const [wizardType, setWizardType] = useState(initialType); // 'skill' | 'personality'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [description, setDescription] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  if (!isOpen) return null;

  const resetAndClose = () => {
    setStep(1);
    setSelectedTemplate(null);
    setFieldValues({});
    setDescription('');
    setPreviewText('');
    setFieldErrors({});
    onClose();
  };

  const templatesForType = wizardTemplates.filter(t => t.type === wizardType);

  const handlePickType = (type) => {
    setWizardType(type);
    setSelectedTemplate(null);
    setStep(2);
  };

  const handlePickTemplate = (template) => {
    setSelectedTemplate(template);
    setFieldValues({});
    setFieldErrors({});
    setStep(3);
  };

  const handleFieldChange = (key, value) => {
    setFieldValues(prev => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleGoToPreview = () => {
    const errors = {};
    for (const field of selectedTemplate.fields) {
      if (field.required && !(fieldValues[field.key] || '').trim()) {
        errors[field.key] = true;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setPreviewText(composeMarkdown(selectedTemplate, { ...fieldValues, description }));
    setStep(4);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/personalities-skills/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type: wizardType,
          content: previewText
        })
      });
      if (res.ok) {
        if (typeof onSaved === 'function') onSaved();
        resetAndClose();
      } else {
        const errData = await res.json();
        alert(errData.error || `Failed to save ${wizardType}.`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const stepTitles = {
    1: 'What would you like to create?',
    2: `Pick a ${wizardType} template`,
    3: 'Fill in the details',
    4: 'Preview & Save'
  };

  return (
    <div className="modal-overlay" onClick={resetAndClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px', width: '92%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wand2 size={20} className="text-accent-primary" /> Creation Wizard — Step {step} of 4
          </h3>
          <button className="btn-icon" onClick={resetAndClose}>
            <X size={20} />
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '12px 0' }}>{stepTitles[step]}</p>

        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
          {/* Step 1: Type */}
          {step === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <button
                type="button"
                onClick={() => handlePickType('skill')}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '24px 16px', cursor: 'pointer', textAlign: 'center', color: '#fff' }}
              >
                <BookOpen size={28} className="text-accent-primary" style={{ marginBottom: '10px' }} />
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Skill</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Teach PATTI a new capability or behavior rule. Multiple skills can be active at once.
                </div>
              </button>
              <button
                type="button"
                onClick={() => handlePickType('personality')}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '24px 16px', cursor: 'pointer', textAlign: 'center', color: '#fff' }}
              >
                <Sliders size={28} className="text-accent-primary" style={{ marginBottom: '10px' }} />
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Personality</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Change PATTI's overall tone and communication style. One personality is active at a time.
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Template picker */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {templatesForType.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handlePickTemplate(template)}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', color: '#fff' }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{template.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{template.purpose}</div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Fields */}
          {step === 3 && selectedTemplate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {selectedTemplate.fields.map(field => (
                <div key={field.key} className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.85rem' }}>
                    {field.label}{field.required && <span style={{ color: 'var(--error, #ef4444)' }}> *</span>}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={field.placeholder}
                    value={fieldValues[field.key] || ''}
                    onChange={e => handleFieldChange(field.key, e.target.value)}
                    style={fieldErrors[field.key] ? { borderColor: '#ef4444' } : undefined}
                  />
                  {fieldErrors[field.key] && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>This field is required.</span>
                  )}
                </div>
              ))}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem' }}>Short Description (optional)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder={selectedTemplate.purpose}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 4: Preview */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Review the generated {wizardType}. You can edit it directly before saving.
              </label>
              <textarea
                className="form-control"
                value={previewText}
                onChange={e => setPreviewText(e.target.value)}
                rows={14}
                style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', minHeight: '220px' }}
              />
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px', marginTop: '12px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setStep(prev => Math.max(1, prev - 1))}
            disabled={step === 1}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: step === 1 ? 0.4 : 1 }}
          >
            <ChevronLeft size={16} /> Back
          </button>

          {step === 3 && (
            <button type="button" className="btn btn-primary" onClick={handleGoToPreview} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Preview <ChevronRight size={16} />
            </button>
          )}
          {step === 4 && (
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !previewText.trim()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={16} /> {saving ? 'Saving...' : `Save ${wizardType === 'skill' ? 'Skill' : 'Personality'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
