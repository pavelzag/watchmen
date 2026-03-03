import { render, screen, fireEvent } from '@testing-library/react';
import ExportButton from './ExportButton';

describe('ExportButton', () => {
    const mockData = [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'viewer' },
    ];

    beforeAll(() => {
        // Mock URL methods that are not available in JSDOM
        global.URL.createObjectURL = jest.fn(() => 'mock-url');
        global.URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the export button correctly', () => {
        render(<ExportButton data={mockData} filename="test-export" />);
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    });

    it('opens the dropdown menu on click', () => {
        render(<ExportButton data={mockData} filename="test-export" />);

        // Initially dropdown should not be visible
        expect(screen.queryByText('Download CSV')).not.toBeInTheDocument();

        // Click to open
        fireEvent.click(screen.getByRole('button', { name: /export/i }));

        expect(screen.getByText('Download CSV')).toBeInTheDocument();
        expect(screen.getByText('Download JSON')).toBeInTheDocument();
    });

    it('calls createObjectURL when downloading JSON', () => {
        render(<ExportButton data={mockData} filename="test-export" />);

        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByText('Download JSON'));

        expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it('closes dropdown when clicking outside', () => {
        render(
            <div>
                <div data-testid="outside">Outside</div>
                <ExportButton data={mockData} filename="test-export" />
            </div>
        );

        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        expect(screen.getByText('Download CSV')).toBeInTheDocument();

        // Click outside
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(screen.queryByText('Download CSV')).not.toBeInTheDocument();
    });
});
