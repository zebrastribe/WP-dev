/**
 * Mantine-style vertical USP tabs — activate tab, panel, and preview figure.
 */
document.querySelectorAll('[data-agency-usp-tabs]').forEach((root) => {
	const items = Array.from(root.querySelectorAll('.agency-usp-tabs__item'));
	const tabs = Array.from(root.querySelectorAll('[data-usp-tab]'));
	const figures = Array.from(root.querySelectorAll('[data-usp-figure]'));

	if (!tabs.length) {
		return;
	}

	const chevronUp =
		'<svg class="agency-usp-tabs__chevron-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>';
	const chevronDown =
		'<svg class="agency-usp-tabs__chevron-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>';

	const activate = (index) => {
		items.forEach((item, i) => {
			const active = i === index;
			item.classList.toggle('is-active', active);
			const tab = item.querySelector('[data-usp-tab]');
			const panel = item.querySelector('[data-usp-panel]');
			const chevron = item.querySelector('[data-usp-chevron]');
			if (tab) {
				tab.setAttribute('aria-selected', active ? 'true' : 'false');
				tab.tabIndex = active ? 0 : -1;
			}
			if (panel) {
				panel.hidden = !active;
			}
			if (chevron) {
				chevron.innerHTML = active ? chevronUp : chevronDown;
			}
		});

		figures.forEach((figure, i) => {
			const show = i === index;
			figure.classList.toggle('is-active', show);
			figure.hidden = !show;
		});
	};

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const index = Number(tab.dataset.uspIndex);
			if (!Number.isNaN(index)) {
				activate(index);
			}
		});

		tab.addEventListener('keydown', (event) => {
			const current = Number(tab.dataset.uspIndex);
			if (Number.isNaN(current)) {
				return;
			}

			let next = current;
			if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
				event.preventDefault();
				next = (current + 1) % tabs.length;
			} else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
				event.preventDefault();
				next = (current - 1 + tabs.length) % tabs.length;
			} else if (event.key === 'Home') {
				event.preventDefault();
				next = 0;
			} else if (event.key === 'End') {
				event.preventDefault();
				next = tabs.length - 1;
			} else {
				return;
			}

			activate(next);
			tabs[next]?.focus();
		});
	});
});
