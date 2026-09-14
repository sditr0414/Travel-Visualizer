import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingHelp } from './SettingHelp';

function setup() {
  render(<SettingHelp title="지도 확대" description="확대 설명"><label>지도 확대<input aria-label="지도 확대 값" /></label></SettingHelp>);
  return { title: screen.getByRole('button', { name: '지도 확대 설명' }), field: screen.getByLabelText('지도 확대 값'), tip: screen.getByRole('tooltip', { hidden: true }) };
}

describe('setting-name help', () => {
  it('shows help from the name, not from hovering its input', async () => {
    const { title, field, tip } = setup();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
    fireEvent.mouseEnter(field);
    expect(tip).toHaveAttribute('hidden');
    fireEvent.mouseEnter(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(title);
    await waitFor(() => expect(tip).toHaveAttribute('hidden'));
  });
  it('keeps the first tap open even when hover and focus precede click', () => {
    const { title, tip } = setup();
    fireEvent.mouseEnter(title);
    fireEvent.focus(title);
    fireEvent.click(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.click(title);
    expect(tip).toHaveAttribute('hidden');
  });
  it('supports keyboard activation and Escape without closing the settings parent', () => {
    const { title, field, tip } = setup();
    expect(field).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.focus(title);
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tip).toHaveAttribute('hidden');
  });
  it('closes pinned help on an outside pointer action', () => {
    const { title, tip } = setup();
    fireEvent.click(title);
    fireEvent.pointerDown(document.body);
    expect(tip).toHaveAttribute('hidden');
  });
});
