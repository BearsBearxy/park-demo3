// ponytail: UNIT_STATUS hardcoded per contract §2.5 — no purple/green per DESIGN-FIDELITY
export const UNIT_STATUS: Record<string, { label: string; sw: string }> = {
  occupied: { label: '在租',    sw: 'var(--accent-slate)' },
  expiring: { label: '即将到期', sw: 'rgba(255,149,0,.5)' },
  reserved: { label: '待入驻',  sw: 'var(--accent-cyan)' },
  vacant:   { label: '空置',    sw: 'transparent' },
}
