import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingHelp } from './SettingHelp';

describe('SettingHelp', () => {
  it('opens only from the question-mark control and closes after leaving it', async () => {
    render(<SettingHelp title="지도 확대" description="설명"><label>지도 확대<input aria-label="지도 확대 값" /></label></SettingHelp>);
    const help = screen.getByRole('button', { name: '지도 확대 설명' });
    const field = screen.getByLabelText('지도 확대 값');

    fireEvent.mouseEnter(field);
    expect(help).toHaveAttribute('aria-expanded', 'false');

    fireEvent.mouseEnter(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('설명');

    fireEvent.mouseLeave(help);
    await waitFor(() => expect(help).toHaveAttribute('aria-expanded', 'false'));
  });
});
