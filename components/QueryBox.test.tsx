import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QueryBox from './QueryBox';
import * as queryHistory from '@/lib/query-history';

// Mock dependencies
jest.mock('@/lib/query-history', () => ({
    getHistory: jest.fn(),
    saveQuery: jest.fn(),
    clearHistory: jest.fn(),
}));

describe('QueryBox', () => {
    const mockOnResult = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (queryHistory.getHistory as jest.Mock).mockReturnValue([]);
        global.fetch = jest.fn();
    });

    it('renders correctly with empty history', () => {
        render(<QueryBox onResult={mockOnResult} />);

        // Check main elements
        expect(screen.getByPlaceholderText(/ask anything about your cloud/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /EXECUTE/i })).toBeInTheDocument();

        // Check suggested queries are visible when input is empty (now have '> ' prefix)
        expect(screen.getByText(/Which buckets are publicly accessible/)).toBeInTheDocument();
    });

    it('handles input and disables button when empty', () => {
        render(<QueryBox onResult={mockOnResult} />);

        const button = screen.getByRole('button', { name: /EXECUTE/i });
        expect(button).toBeDisabled();

        const textarea = screen.getByPlaceholderText(/ask anything about your cloud/i);
        fireEvent.change(textarea, { target: { value: 'test query' } });

        expect(button).not.toBeDisabled();
        expect(textarea).toHaveValue('test query');
    });

    it('submits query successfully and calls onResult', async () => {
        const mockResult = {
            query: 'test query',
            answer: 'mock answer',
            intent: { queryType: 'test' },
            fetchedAt: new Date().toISOString()
        };

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue(mockResult)
        });

        render(<QueryBox onResult={mockOnResult} />);

        const textarea = screen.getByPlaceholderText(/ask anything about your cloud/i);
        fireEvent.change(textarea, { target: { value: 'test query' } });

        const button = screen.getByRole('button', { name: /EXECUTE/i });
        fireEvent.click(button);

        // Loading state
        expect(screen.getByText('EXECUTING...')).toBeInTheDocument();

        await waitFor(() => {
            expect(mockOnResult).toHaveBeenCalledWith(mockResult);
        });

        expect(queryHistory.saveQuery).toHaveBeenCalledWith('test query', 'mock answer');
    });

    it('handles API errors gracefully', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            json: jest.fn().mockResolvedValue({ error: 'Test error message' })
        });

        render(<QueryBox onResult={mockOnResult} />);

        const textarea = screen.getByPlaceholderText(/ask anything about your cloud/i);
        fireEvent.change(textarea, { target: { value: 'bad query' } });
        fireEvent.click(screen.getByRole('button', { name: /EXECUTE/i }));

        await waitFor(() => {
            expect(screen.getByText(/!! ERROR: Test error message/)).toBeInTheDocument();
        });
    });

    it('renders and uses history when available', () => {
        (queryHistory.getHistory as jest.Mock).mockReturnValue([
            { query: 'history item 1', savedAt: 123 },
            { query: 'history item 2', savedAt: 456 }
        ]);

        render(<QueryBox onResult={mockOnResult} />);

        // History button should be visible
        expect(screen.getByText(/\/\/ history/)).toBeInTheDocument();

        // Click to expand
        fireEvent.click(screen.getByText(/\/\/ history/));

        expect(screen.getByText(/↑ history item 1/)).toBeInTheDocument();
        expect(screen.getByText(/↑ history item 2/)).toBeInTheDocument();

        // Click a history item should populate the input
        fireEvent.click(screen.getByText(/↑ history item 1/));
        expect(screen.getByPlaceholderText(/ask anything about your cloud/i)).toHaveValue('history item 1');
    });
});
