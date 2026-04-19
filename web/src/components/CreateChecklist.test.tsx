import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateChecklist, { type ChecklistStep } from './CreateChecklist';

function makeStep(overrides: Partial<ChecklistStep> = {}): ChecklistStep {
  return { id: 'step1', label: 'Do something', status: 'pending', ...overrides };
}

describe('CreateChecklist', () => {
  test('renders step labels', () => {
    const steps = [
      makeStep({ id: 'a', label: 'Upload video' }),
      makeStep({ id: 'b', label: 'Submit tx' }),
    ];
    render(<CreateChecklist steps={steps} />);
    expect(screen.getByText('Upload video')).toBeInTheDocument();
    expect(screen.getByText('Submit tx')).toBeInTheDocument();
  });

  test('shows checkmark for done status', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'done', label: 'Done step' })]} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  test('shows ✗ for error status', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'error', label: 'Failed step' })]} />);
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  test('shows dot for pending status', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'pending', label: 'Pending step' })]} />);
    expect(screen.getByText('·')).toBeInTheDocument();
  });

  test('shows spinner for running status', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'running', label: 'Running step' })]} />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  test('shows detail text when provided', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'running', detail: '42%' })]} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  test('shows errorMsg when status is error', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'error', errorMsg: 'Network timeout' })]} />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  test('shows Retry button when status is error and onRetry is provided', () => {
    render(
      <CreateChecklist
        steps={[makeStep({ id: 'upload', status: 'error' })]}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  test('calls onRetry with step id when Retry is clicked', () => {
    const onRetry = vi.fn();
    render(
      <CreateChecklist
        steps={[makeStep({ id: 'upload', status: 'error' })]}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledWith('upload');
  });

  test('does not show Retry button when onRetry is not provided', () => {
    render(<CreateChecklist steps={[makeStep({ status: 'error' })]} />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
