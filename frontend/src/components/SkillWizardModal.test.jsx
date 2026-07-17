import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SkillWizardModal from './SkillWizardModal';
import { wizardTemplates, renderTemplate, composeMarkdown } from '../data/wizardTemplates';

describe('Wizard Templates Catalog', () => {
  test('every template declares fields matching its {{placeholders}}', () => {
    for (const template of wizardTemplates) {
      const placeholders = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
      const fieldKeys = template.fields.map(f => f.key);
      for (const placeholder of placeholders) {
        expect(fieldKeys, `template "${template.id}" is missing field for {{${placeholder}}}`).toContain(placeholder);
      }
    }
  });

  test('catalog contains both skill and personality templates', () => {
    expect(wizardTemplates.some(t => t.type === 'skill')).toBe(true);
    expect(wizardTemplates.some(t => t.type === 'personality')).toBe(true);
  });

  test('renderTemplate substitutes provided values', () => {
    const template = wizardTemplates.find(t => t.id === 'web_grounded_research');
    const body = renderTemplate(template, {
      name: 'Stock Lookup',
      topic: 'stock prices',
      web_search_triggers: 'any price question',
      output_style: 'bullets'
    });
    expect(body).toContain('Stock Lookup');
    expect(body).toContain('stock prices');
    expect(body).not.toContain('{{');
  });

  test('composeMarkdown produces YAML frontmatter the import endpoint understands', () => {
    const template = wizardTemplates.find(t => t.id === 'concise_expert');
    const md = composeMarkdown(template, { name: 'The Specialist', description: 'Terse expert' });
    expect(md).toMatch(/^---\nname: The Specialist\ndescription: Terse expert\n---/);
  });
});

describe('SkillWizardModal Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test('renders nothing when closed', () => {
    const { container } = render(
      <SkillWizardModal isOpen={false} onClose={() => {}} token="t" onSaved={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('walks type -> template -> fields -> preview and validates required fields', async () => {
    render(<SkillWizardModal isOpen={true} onClose={() => {}} token="t" onSaved={() => {}} />);

    // Step 1: pick Skill
    fireEvent.click(screen.getByText('Skill'));

    // Step 2: pick the Web-Grounded Research template
    fireEvent.click(screen.getByText('Web-Grounded Research'));

    // Step 3: try to preview with empty required fields -> validation errors
    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getAllByText('This field is required.').length).toBeGreaterThan(0);

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText('e.g. Stock Market Research'), { target: { value: 'Stock Research' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. stock prices and market movements'), { target: { value: 'stock info' } });
    fireEvent.change(screen.getByPlaceholderText("e.g. any question about current prices, tickers, or today's market"), { target: { value: 'any stock question' } });

    // Step 4: preview shows substituted markdown
    fireEvent.click(screen.getByText('Preview'));
    const textarea = screen.getByRole('textbox');
    expect(textarea.value).toContain('name: Stock Research');
    expect(textarea.value).toContain('stock info');
    expect(textarea.value).not.toContain('{{');
  });

  test('saves via POST /api/personalities-skills/import and calls onSaved', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(<SkillWizardModal isOpen={true} onClose={onClose} token="test-token" onSaved={onSaved} />);

    fireEvent.click(screen.getByText('Personality'));
    fireEvent.click(screen.getByText('Concise Expert'));
    fireEvent.change(screen.getByPlaceholderText('e.g. The Specialist'), { target: { value: 'My Expert' } });
    fireEvent.click(screen.getByText('Preview'));
    fireEvent.click(screen.getByText('Save Personality'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(global.fetch).toHaveBeenCalledWith('/api/personalities-skills/import', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Authorization': 'Bearer test-token' })
    }));
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.type).toBe('personality');
    expect(sentBody.content).toContain('name: My Expert');
    expect(onClose).toHaveBeenCalled();
  });
});
