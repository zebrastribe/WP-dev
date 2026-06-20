/**
 * USP Tabs block editor (Mantine Tabs vertical preview).
 */
const { registerBlockType } = wp.blocks;
const { useBlockProps, RichText, InspectorControls } = wp.blockEditor;
const { PanelBody, TextControl, TextareaControl, SelectControl, Button } = wp.components;
const { Fragment } = wp.element;

const ICON_OPTIONS = [
	{ label: 'Briefcase', value: 'briefcase' },
	{ label: 'Banknotes', value: 'banknotes' },
	{ label: 'User group', value: 'user-group' },
	{ label: 'Users', value: 'users' },
	{ label: 'Globe', value: 'globe-alt' },
	{ label: 'Building', value: 'building-office' },
];

const DEFAULT_ITEMS = [
	{ title: 'Employer services', description: 'Need to hire anyone, anywhere? We handle contracts, compliance, and onboarding — in days, not months.', ctaLabel: 'Learn more', ctaUrl: '/employers/', imageUrl: '', icon: 'briefcase' },
	{ title: 'Global payroll', description: 'Accurate, compliant payroll in every market you operate. Run by in-house specialists, not a partner network.', ctaLabel: 'Learn more', ctaUrl: '/employers/', imageUrl: '', icon: 'banknotes' },
	{ title: 'Contractor management', description: 'Engage international contractors compliantly. Contracts, payments, and risk — handled end to end.', ctaLabel: 'Learn more', ctaUrl: '/candidates/', imageUrl: '', icon: 'user-group' },
	{ title: 'Candidate matching', description: 'Source, screen, and place talent faster with a dedicated consultant and a curated shortlist.', ctaLabel: 'Learn more', ctaUrl: '/candidates/', imageUrl: '', icon: 'users' },
];

registerBlockType('agency-starter/usp-tabs', {
	edit({ attributes, setAttributes }) {
		const { eyebrow, heading, items } = attributes;
		const blockProps = useBlockProps({
			className: 'agency-usp-tabs-editor alignfull agency-section agency-section--alt',
		});

		const updateItem = (index, field, value) => {
			setAttributes({
				items: items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
			});
		};

		const addItem = () => {
			if (items.length >= 6) return;
			setAttributes({
				items: [...items, { title: 'New service', description: 'Description.', ctaLabel: 'Learn more', ctaUrl: '/contact/', imageUrl: '', icon: 'briefcase' }],
			});
		};

		const removeItem = (index) => {
			if (items.length <= 1) return;
			setAttributes({ items: items.filter((_, i) => i !== index) });
		};

		return wp.element.createElement(
			Fragment,
			null,
			wp.element.createElement(
				InspectorControls,
				null,
				wp.element.createElement(
					PanelBody,
					{ title: 'Tabs', initialOpen: true },
					items.map((item, index) =>
						wp.element.createElement(
							'div',
							{ key: index, style: { marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' } },
							wp.element.createElement(SelectControl, {
								label: `Tab ${index + 1} icon (Heroicon)`,
								value: item.icon || 'briefcase',
								options: ICON_OPTIONS,
								onChange: (v) => updateItem(index, 'icon', v),
							}),
							wp.element.createElement(TextControl, { label: 'Title', value: item.title, onChange: (v) => updateItem(index, 'title', v) }),
							wp.element.createElement(TextareaControl, { label: 'Description', value: item.description, onChange: (v) => updateItem(index, 'description', v) }),
							wp.element.createElement(TextControl, { label: 'CTA label', value: item.ctaLabel, onChange: (v) => updateItem(index, 'ctaLabel', v) }),
							wp.element.createElement(TextControl, { label: 'CTA URL', value: item.ctaUrl, onChange: (v) => updateItem(index, 'ctaUrl', v) }),
							wp.element.createElement(TextControl, { label: 'Preview image URL', value: item.imageUrl, onChange: (v) => updateItem(index, 'imageUrl', v), help: 'Empty = theme placeholder.' }),
							wp.element.createElement(Button, { isDestructive: true, onClick: () => removeItem(index) }, 'Remove tab'),
						),
					),
					wp.element.createElement(Button, { variant: 'secondary', onClick: addItem }, 'Add tab'),
				),
			),
			wp.element.createElement(
				'div',
				blockProps,
				wp.element.createElement(RichText, { tagName: 'p', className: 'agency-eyebrow', value: eyebrow, onChange: (v) => setAttributes({ eyebrow: v }), placeholder: 'Eyebrow' }),
				wp.element.createElement(RichText, { tagName: 'h2', className: 'agency-section__title', value: heading, onChange: (v) => setAttributes({ heading: v }), placeholder: 'Section heading' }),
				wp.element.createElement('p', { style: { opacity: 0.7 } }, `${items.length} vertical tabs (Mantine-style) — preview updates on the front end.`),
			),
		);
	},
	save() {
		return null;
	},
});
