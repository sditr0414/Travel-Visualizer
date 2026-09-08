import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingHelp } from './SettingHelp';

describe('SettingHelp', () => {
  it('opens from the setting name without rendering a question-mark button', async () => {
    render(<SettingHelp title="지도 확대" description="설명"><label>지도 확대<input aria-label="지도 확대 값" /></label></SettingHelp>);
    const title = document.querySelector('.setting-help-anchor') as HTMLElement | null;
    const field = screen.getByLabelText('지도 확대 값');
    const tooltip = screen.getByRole('tooltip', { hidden: true });

    expect(title).not.toBeNull();
    expect(screen.queryByRole('button', { name: '지도 확대 설명' })).not.toBeInTheDocument();
    expect(tooltip).toHaveAttribute('hidden');

    fireEvent.mouseEnter(field);
    expect(tooltip).toHaveAttribute('hidden');

    fireEvent.mouseEnter(title!);
    expect(tooltip).not.toHaveAttribute('hidden');
    expect(tooltip).toHaveTextContent('설명');

    fireEvent.mouseLeave(title!);
    await waitFor(() => expect(tooltip).toHaveAttribute('hidden'));
  });
});
