import { Dialog } from './ui';
import { IconMail, IconPhone } from './Icons';
import { useWizard } from '../context/WizardContext';
import { CONTACT } from '../lib/contact';

// "Nhận lộ trình xuất ngoại MIỄN PHÍ": StudyLink's public contact details
// (from lib/contact.js — one place to update them).
export default function ContactDialog({ onClose }) {
  const { w } = useWizard();
  return (
    <Dialog title={w('contactTitle')} onClose={onClose} closeLabel={w('close')} wide>
      <p>{w('contactIntro')}</p>
      <ul className="wz-contact-list">
        <li>
          <a className="wz-contact-item" href={`tel:${CONTACT.hotline.tel}`}>
            <IconPhone width={22} height={22} />
            <span><small>{w('hotline')}</small><strong>{CONTACT.hotline.display}</strong></span>
          </a>
        </li>
        <li>
          <a className="wz-contact-item" href={CONTACT.zalo} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true" style={{ fontWeight: 800, color: '#0068ff', width: 22, textAlign: 'center' }}>Z</span>
            <span><small>Zalo</small><strong>{w('chatZalo')}</strong></span>
          </a>
        </li>
        <li>
          <a className="wz-contact-item" href={`mailto:${CONTACT.email}`}>
            <IconMail width={22} height={22} />
            <span><small>Email</small><strong>{CONTACT.email}</strong></span>
          </a>
        </li>
      </ul>

      <p className="wz-contact-head">{w('offices')}</p>
      <ul className="wz-contact-list">
        {CONTACT.offices.map((o) => (
          <li key={o.city}>
            <a className="wz-contact-item" href={`tel:${o.tel}`}>
              <IconPhone width={22} height={22} />
              <span><strong>{o.city} · {o.phone}</strong><small>{o.address}</small></span>
            </a>
          </li>
        ))}
      </ul>

      <p className="wz-contact-head">{w('followUs')}</p>
      <div className="wz-social">
        <a href={CONTACT.website} target="_blank" rel="noopener noreferrer">studylink.org</a>
        <a href={CONTACT.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
        <a href={CONTACT.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
        <a href={CONTACT.youtube} target="_blank" rel="noopener noreferrer">YouTube</a>
      </div>
    </Dialog>
  );
}
