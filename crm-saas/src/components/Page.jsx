import { useAuth } from '../lib/AuthContext';
import NotifBell from './NotifBell';

function initials(str) {
  if (!str) return '?';
  const parts = str.split(/[@.\s]+/).filter(Boolean);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

function hue(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return h % 360;
}

export function Avatar({ name, size = 34 }) {
  const ini = initials(name);
  const h   = hue(name);
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${h},60%,52%), hsl(${(h+40)%360},60%,44%))`,
      color: '#fff', fontWeight: 800, fontSize: size * 0.37,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {ini}
    </div>
  );
}

export function CoAvatar({ company, size = 34 }) {
  const words = (company || '?').split(/\s+/).filter(Boolean);
  const ini   = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (words[0] || '?').slice(0, 2).toUpperCase();
  const h = hue(company);
  return (
    <div title={company} style={{
      width: size, height: size, borderRadius: 9, flexShrink: 0,
      background: `hsl(${h},55%,92%)`,
      color: `hsl(${h},55%,32%)`,
      fontWeight: 800, fontSize: size * 0.37,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {ini}
    </div>
  );
}

export default function Page({ title, actions, children }) {
  const { profile } = useAuth();
  return (
    <>
      <div className="topbar">
        <h2>{title}</h2>
        <div className="row" style={{ gap: 10 }}>
          {actions}
          <NotifBell />
          <Avatar name={profile?.full_name || profile?.email} size={34} />
        </div>
      </div>
      <div className="content">{children}</div>
    </>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="overlay" onClick={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function statusPill(status) {
  const map = {
    'New Lead':      'pill-new',
    'Contacted':     'pill-contacted',
    'Qualified':     'pill-qualified',
    'Proposal Sent': 'pill-proposal',
    'Negotiation':   'pill-proposal',
    'Closed Won':    'pill-won',
    'Closed Lost':   'pill-lost',
  };
  return <span className={`pill ${map[status] || 'pill-default'}`}>{status}</span>;
}
