// Shows changed lines next to unchanged ones. "hot" marks the risky line with a coloured bar.
export default function Diff({ ops, start, hot = -1, sev = '' }) {
  return (
    <pre className="diff" aria-label="Preview of the change">
      {ops.map((op, i) => (
        <div key={i} className={'dl ' + op.t + (op.t !== 'add' && op.ai === hot ? ' hot ' + sev : '')}>
          <span className="no">{op.t === 'add' ? '' : start + op.ai + 1}</span>
          <span className="sign">{op.t === 'add' ? '+' : op.t === 'del' ? '−' : ' '}</span>
          <span className="code">{op.text || ' '}</span>
        </div>
      ))}
    </pre>
  )
}
