export function IdleModePanel() {
  return (
    <div className="studio-mode-block">
      <header className="mode-panel-intro">
        <h2 className="mode-panel-title">Idle</h2>
        <p className="subtitle mode-panel-desc">
          Blackout output via <code>POST /api/v1/mode</code> with <code>idle</code>. Clears the selected loop
          sequence.
        </p>
      </header>
    </div>
  )
}
