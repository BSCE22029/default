export default function Page({ title, actions, children }) {
  return (
    <>
      <div className="topbar">
        <h2>{title}</h2>
        <div className="row">{actions}</div>
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
          <span className="x" onClick={onClose}>×</span>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function statusPill(status) {
  const map = {
    'New Lead': 'pill-new', 'Contacted': 'pill-contacted', 'Qualified': 'pill-qualified',
    'Proposal Sent': 'pill-proposal', 'Negotiation': 'pill-proposal',
    'Closed Won': 'pill-won', 'Closed Lost': 'pill-lost',
  };
  return <span className={`pill ${map[status] || 'pill-default'}`}>{status}</span>;
}
