const stages = ['collecting', 'evaluating', 'reporting', 'complete'];
export function showBriefProgress(update) {
  const panel = document.getElementById('brief-progress-panel');
  panel.hidden = false; panel.classList.remove('is-stopped');
  const index = stages.indexOf(update.stage);
  const bar = document.getElementById('brief-progress');
  const fraction = update.total ? Math.min(1, Math.max(0, update.done / update.total)) : 0;
  // This is stage progress, not a fabricated time estimate. The report-writing
  // stage holds steady until the server confirms the report has been saved.
  bar.value = update.stage === 'collecting' ? fraction * 25 : update.stage === 'evaluating' ? 25 + fraction * 40 : update.stage === 'reporting' ? 75 : 100;
  bar.setAttribute('aria-valuetext', update.message);
  for (const [i, step] of [...document.querySelectorAll('.brief-stages li')].entries()) {
    step.classList.toggle('is-active', i === index); step.classList.toggle('is-complete', i < index);
    if (i === index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  }
  document.getElementById('brief-status').textContent = update.message;
}
export function stopBriefProgress(message) {
  document.getElementById('brief-progress-panel').classList.add('is-stopped');
  document.getElementById('brief-progress').setAttribute('aria-valuetext', message);
  for (const step of document.querySelectorAll('.brief-stages li')) { step.removeAttribute('aria-current'); step.classList.remove('is-active'); }
}
