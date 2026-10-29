// Print button on invoices and reports. Pages marked data-autoprint open the print dialog right away.
document.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
if (document.body.dataset.autoprint) window.addEventListener('load', () => window.print());
