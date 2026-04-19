export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface ChecklistStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  errorMsg?: string;
}

interface Props {
  steps: ChecklistStep[];
  onRetry?: (stepId: string) => void;
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <span className="text-accent-green">✓</span>;
  if (status === 'error') return <span className="text-accent-red">✗</span>;
  if (status === 'running') {
    return (
      <span className="inline-block w-3 h-3 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
    );
  }
  return <span className="text-text-muted">·</span>;
}

export default function CreateChecklist({ steps, onRetry }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 w-4 shrink-0 flex justify-center">
            <StatusIcon status={step.status} />
          </span>
          <span className={
            step.status === 'done' ? 'text-text-secondary'
            : step.status === 'error' ? 'text-accent-red'
            : step.status === 'running' ? 'text-text-primary'
            : 'text-text-muted'
          }>
            {step.label}
            {step.detail && <span className="text-text-muted ml-1">{step.detail}</span>}
            {step.status === 'error' && step.errorMsg && (
              <span className="block text-xs text-accent-red mt-0.5">{step.errorMsg}</span>
            )}
            {step.status === 'error' && onRetry && (
              <button
                onClick={() => onRetry(step.id)}
                className="ml-2 text-xs text-polka-400 hover:text-polka-300 underline"
              >
                Retry
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
