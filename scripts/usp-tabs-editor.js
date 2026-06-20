const { registerBlockType } = wp.blocks;
const { useBlockProps, RichText, InspectorControls } = wp.blockEditor;
const { PanelBody, TextControl, TextareaControl, Button } = wp.components;
const { Fragment } = wp.element;
const DEFAULT_ITEMS = [
	{ title: 'Employer services', description: 'Need to hire anyone, anywhere? We handle contracts, compliance, and onboarding — in days, not months.', ctaLabel: 'Learn more', ctaUrl: '/employers/', imageUrl: '' },
	{ title: 'Global payroll', description: 'Accurate, compliant payroll in every market you operate. Run by in-house specialists, not a partner network.', ctaLabel: 'Learn more', ctaUrl: '/employers/', imageUrl: '' },
	{ title: 'Contractor management', description: 'Engage international contractors compliantly. Contracts, payments, and risk — handled end to end.', ctaLabel: 'Learn more', ctaUrl: '/candidates/', imageUrl: '' },
	{ title: 'Candidate matching', description: 'Source, screen, and place talent faster with a dedicated consultant and a curated shortlist.', ctaLabel: 'Learn more', ctaUrl: '/candidates/', imageUrl: '' },
];
registerBlockType('agency-starter/usp-tabs', {
	title: 'USP Tabs', icon: 'table-row-after', category: 'design',
	description: 'Vertical tab USP section with expandable items and a preview panel.',
	supports: { align: ['full'] },
	attributes: {
		eyebrow: { type: 'string', default: 'How we do it' },
		heading: { type: 'string', default: 'One platform. Every hiring need.' },
		items: { type: 'array', default: DEFAULT_ITEMS },
	},
	edit({ attributes, setAttributes }) {
		const { eyebrow, heading, items } = attributes;
		const blockProps = useBlockProps({ className: 'agency-usp-tabs-editor alignfull agency-section agency-section--alt' });
		const updateItem = (index, field, value) => setAttributes({ items: items.map((item, i) => (i === index ? { ...item, [field]: value } : item)) });
		const addItem = () => { if (items.length < 6) setAttributes({ items: [...items, { title: 'New service', description: 'Description for this service.', ctaLabel: 'Learn more', ctaUrl: '/contact/', imageUrl: '' }] }); };
		const removeItem = (index) => { if (items.length > 1) setAttributes({ items: items.filter((_, i) => i !== index) }); };
		return wp.element.createElement(Fragment, null,
			wp.element.createElement(InspectorControls, null,
				wp.element.createElement(PanelBody, { title: 'Tab items', initialOpen: true },
					items.map((item, index) => wp.element.createElement('div', { key: index, style: { marginBottom: '1rem' } },
						wp.element.createElement(TextControl, { label: `Tab ${index + 1} title`, value: item.title, onChange: (v) => updateItem(index, 'title', v) }),
						wp.element.createElement(TextareaControl, { label: 'Description', value: item.description, onChange: (v) => updateItem(index, 'description', v) }),
						wp.element.createElement(TextControl, { label: 'CTA label', value: item.ctaLabel, onChange: (v) => updateItem(index, 'ctaLabel', v) }),
						wp.element.createElement(TextControl, { label: 'CTA URL', value: item.ctaUrl, onChange: (v) => updateItem(index, 'ctaUrl', v) }),
						wp.element.createElement(TextControl, { label: 'Preview image URL (optional)', value: item.imageUrl, onChange: (v) => updateItem(index, 'imageUrl', v), help: 'Leave empty to use theme placeholder.' }),
						wp.element.createElement(Button, { isDestructive: true, onClick: () => removeItem(index), style: { marginTop: '0.5rem' } }, 'Remove tab'),
					)),
					wp.element.createElement(Button, { variant: 'secondary', onClick: addItem }, 'Add tab'),
				),
			),
			wp.element.createElement('div', blockProps,
				wp.element.createElement(RichText, { tagName: 'p', className: 'agency-eyebrow', value: eyebrow, onChange: (v) => setAttributes({ eyebrow: v }), placeholder: 'Eyebrow' }),
				wp.element.createElement(RichText, { tagName: 'h2', className: 'agency-section__title', value: heading, onChange: (v) => setAttributes({ heading: v }), placeholder: 'Section heading' }),
				wp.element.createElement('div', { className: 'agency-usp-tabs__grid' },
					wp.element.createElement('div', { className: 'agency-usp-tabs__list' },
						items.map((item, index) => wp.element.createElement('div', { key: index, className: 'agency-usp-tabs__item' + (index === 0 ? ' is-active' : '') },
							wp.element.createElement('div', { className: 'agency-usp-tabs__trigger' },
								wp.element.createElement('span', { className: 'agency-usp-tabs__icon agency-usp-tabs__icon--1' }),
								wp.element.createElement('span', { className: 'agency-usp-tabs__label' }, item.title),
							),
							index === 0 ? wp.element.createElement('p', { className: 'agency-usp-tabs__description' }, item.description) : null,
						)),
					),
					wp.element.createElement('div', { className: 'agency-usp-tabs__preview' }, wp.element.createElement('p', null, 'Preview panel swaps per tab on the front end.')),
				),
			),
		);
	},
	save() { return null; },
});
