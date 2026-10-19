import { describe, expect, it } from 'vitest';
import { parseLine } from './parse';

describe('parseLine', () => {
	it.each([
		['9am Dentist', { title: 'Dentist', time: '09:00' }],
		['845 ADHD follow-up', { title: 'ADHD follow-up', time: '08:45' }],
		['8:45 ADHD follow-up', { title: 'ADHD follow-up', time: '08:45' }],
		['2:30pm Call', { title: 'Call', time: '14:30' }],
		['2:30 p.m. Call', { title: 'Call', time: '14:30' }],
		['8 - Terry Fox', { title: 'Terry Fox', time: '08:00' }],
		['3 Kids pickup', { title: 'Kids pickup', time: '15:00' }],
		['12 Lunch', { title: 'Lunch', time: '12:00' }],
		['12am Server backup', { title: 'Server backup', time: '00:00' }],
		['1230 Lunch', { title: 'Lunch', time: '12:30' }],
		['17:00 Bag to truck', { title: 'Bag to truck', time: '17:00' }]
	])('reads "%s"', (text, expected) => {
		expect(parseLine(text)).toEqual(expected);
	});

	it.each(['Pick up meds', '  Green cart  ', '10am', '99 Problems', '3D printer filament'])('keeps "%s" as a plain title', (text) => {
		expect(parseLine(text)).toEqual({ title: text.trim() });
	});
});
