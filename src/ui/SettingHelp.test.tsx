import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingHelp } from './SettingHelp';

function setup() {
  render(<SettingHelp title="지도 확대" description="확대 설명"><label>지도 확대<input aria-label="지도 확대 값" /></label></SettingHelp>);
  return { title: screen.getByRole('button', { name: '지도 확대 설명' }), field: screen.getByLabelText('지도 확대 값'), tip: screen.getByRole('tooltip', { hidden: true }) };
}

describe('setting-name help', () => {
  it('shows help after resting on the name, not from hovering its input', async () => {
    const { title, field, tip } = setup();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
    fireEvent.mouseEnter(field);
    expect(tip).toHaveAttribute('hidden');
    fireEvent.mouseEnter(title);
    expect(tip).toHaveAttribute('hidden');
    await waitFor(() => expect(tip).not.toHaveAttribute('hidden'));
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
  it('does not open a popup while the actual input is being edited', () => {
    const { title, field, tip } = setup();
    fireEvent.focus(field);
    expect(tip).toHaveAttribute('hidden');
    fireEvent.click(title);
    fireEvent.focus(field);
    expect(tip).toHaveAttribute('hidden');
  });
  it('allows only one explanation at a time', () => {
    const { title, tip } = setup();
    render(<SettingHelp title="사진 표시 시간" description="시간 설명"><label>사진 표시 시간<input /></label></SettingHelp>);
    fireEvent.click(title);
    fireEvent.click(screen.getByRole('button', { name: '사진 표시 시간 설명' }));
    expect(tip).toHaveAttribute('hidden');
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('시간 설명');
  });
  it('keeps the bubble hoverable across the gap from the label', async () => {
    const { title, tip } = setup();
    fireEvent.mouseEnter(title);
    await waitFor(() => expect(tip).not.toHaveAttribute('hidden'));
    fireEvent.mouseLeave(title);
    fireEvent.mouseEnter(tip);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(tip);
    await waitFor(() => expect(tip).toHaveAttribute('hidden'));
  });
  it('dismisses on scrolling away rather than leaving a detached portal', () => {
    const { title, tip } = setup();
    fireEvent.click(title);
    fireEvent.scroll(window);
    expect(tip).toHaveAttribute('hidden');
  });
  it('closes the portal when its settings details is collapsed', async () => {
    const view = render(<details open><summary>설정</summary><SettingHelp title="확대" description="확대 설명"><label>확대<input /></label></SettingHelp></details>);
    fireEvent.click(screen.getByRole('button', { name: '확대 설명' }));
    const tip = screen.getByRole('tooltip');
    view.container.querySelector('details')!.open = false;
    await waitFor(() => expect(tip).toHaveAttribute('hidden'));
  });
});
