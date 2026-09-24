// One quiz question: a numbered card with a segmented progress strip and a real
// radio group (visually styled labels over native inputs → keyboard + screen-reader
// friendly). Used by the 9-question index quiz and the 15-question career quiz.
//   options: [{ value, label }]      value: the currently stored value (compared with ===)
export default function QuizCard({ id, index, total, title, description, options, value, onChange, missing, name, srLabel }) {
  return (
    <fieldset id={id} className={`wz-quiz${missing ? ' wz-quiz--missing' : ''}`}>
      <div className="wz-progress" aria-hidden="true">
        {Array.from({ length: total }, (_, j) => (
          <span key={j} className={j <= index ? `on${j === index ? ' end' : ''}` : ''} />
        ))}
      </div>
      <legend>
        <span className="wz-quiz-head">
          <span className="wz-quiz-num" aria-hidden="true">{index + 1}</span>
          <span>
            {srLabel && <span className="wz-sr">{srLabel}: </span>}
            <span className="wz-quiz-q" style={{ display: 'block' }}>{title}</span>
            {description && <span className="wz-quiz-d" style={{ display: 'block' }}>{description}</span>}
          </span>
        </span>
      </legend>
      <div className="wz-opts">
        {options.map((o) => (
          <label key={o.value} className="wz-opt">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
