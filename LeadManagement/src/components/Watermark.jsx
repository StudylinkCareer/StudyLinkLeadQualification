// src/components/Watermark.jsx
import { useAuth } from '../contexts/AuthContext';

export default function Watermark() {
  const { staff } = useAuth();
  if (!staff) return null;
  const text = `${staff.fullName} — ${new Date().toLocaleDateString('en-GB')}`;
  return (
    <div aria-hidden="true" style={{
      position:'fixed', top:0, left:0, right:0, bottom:0,
      pointerEvents:'none', zIndex:9999, overflow:'hidden',
    }}>
      {Array.from({ length: 30 }).map((_, i) => (
        <div key={i} style={{
          position:'absolute',
          left:`${(i % 5) * 22}%`,
          top:`${Math.floor(i / 5) * 18}%`,
          transform:'rotate(-25deg)',
          fontSize:'0.75rem', fontWeight:500,
          color:'rgba(0,0,0,0.045)',
          whiteSpace:'nowrap', userSelect:'none',
          letterSpacing:'0.05em',
        }}>{text}</div>
      ))}
    </div>
  );
}
