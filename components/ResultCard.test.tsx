import { render, screen, fireEvent } from '@testing-library/react';
import ResultCard from './ResultCard';
import type { QueryResult } from './QueryBox';

describe('ResultCard', () => {
    const mockResult: QueryResult = {
        query: 'Show me bucket public access',
        answer: 'Here is the analysis:\n- Bucket A is public\n- Bucket B is **private**',
        intent: {
            queryType: 'specific_resource_access',
            user: 'test-user@example.com',
            resourceType: 'bucket'
        },
        resources: [
            { type: 'bucket', name: 'my-public-bucket', projectId: 'proj-1' },
            { type: 'bucket', name: 'my-private-bucket', projectId: 'proj-1', extra: 'secure' }
        ],
        fetchedAt: '2023-01-01T12:00:00Z'
    };

    it('renders basic query information', () => {
        render(<ResultCard result={mockResult} index={0} />);

        expect(screen.getByText('#01')).toBeInTheDocument();
        expect(screen.getByText(/Show me bucket public access/)).toBeInTheDocument();

        // Verify tag is formatted (underscores to spaces)
        expect(screen.getByText('specific resource access')).toBeInTheDocument();
    });

    it('renders markdown in answer correctly', () => {
        render(<ResultCard result={mockResult} index={0} />);

        // Check if the answer text is there
        expect(screen.getByText(/Here is the analysis:/)).toBeInTheDocument();
        // In our simple markdown implementation, **private** becomes <strong>private</strong>
        // React Testing library will find it if it's rendered as text
        expect(screen.getByText(/Bucket B is/)).toBeInTheDocument();
    });

    it('renders resource chips correctly', () => {
        render(<ResultCard result={mockResult} index={0} />);

        expect(screen.getByText(/\/\/ 2 resource/)).toBeInTheDocument();
        expect(screen.getByText('my-public-bucket')).toBeInTheDocument();
        expect(screen.getByText('my-private-bucket')).toBeInTheDocument();
        expect(screen.getByText('secure')).toBeInTheDocument(); // The extra prop
    });

    it('renders jump-to links based on intent', () => {
        render(<ResultCard result={mockResult} index={0} />);

        expect(screen.getByText(/\/\/ navigate:/)).toBeInTheDocument();
        // based on user: test-user@example.com — inside a Link
        expect(screen.getByText(/test-user@example.com/)).toBeInTheDocument();
        // based on resourceType: bucket — now displayed as [Buckets]
        expect(screen.getByText(/\[Buckets\]/)).toBeInTheDocument();
    });

    it('renders workflow actions when provided', () => {
        render(
            <ResultCard
                result={{
                    ...mockResult,
                workflow: {
                        kind: "remediate",
                        summary: "Watchmen can open the filtered findings and launch the remediation flow from there.",
                        actions: [
                            { label: "Open findings", href: "/dashboard/findings?cloud=gcp&severity=critical" },
                            { label: "Create PR", href: "/dashboard/findings?cloud=gcp&severity=critical&remediate=1" },
                        ],
                        stages: [
                            { label: "Open filtered findings" },
                            { label: "Generate Terraform preview" },
                            { label: "Create PR with fixes" },
                        ],
                    },
                }}
                index={0}
            />
        );

        expect(screen.getByText(/security workflow/)).toBeInTheDocument();
        expect(screen.getByText(/workflow stages/i)).toBeInTheDocument();
        expect(screen.getByText(/open the filtered findings and launch the remediation flow/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open findings/i })).toHaveAttribute('href', '/dashboard/findings?cloud=gcp&severity=critical');
        expect(screen.getByRole('link', { name: /create pr/i })).toHaveAttribute('href', '/dashboard/findings?cloud=gcp&severity=critical&remediate=1');
    });

    it('toggles intent debug information', () => {
        render(<ResultCard result={mockResult} index={0} />);

        expect(screen.queryByText(/test-user@example.com/)).toBeInTheDocument(); // The jump link

        // The raw JSON shouldn't be visible yet (or rather, the pre shouldn't be visible)
        // Finding the exact JSON string might be tricky, but we can look for the specific queryType key

        const toggleBtn = screen.getByText(/\/\/ debug intent/);
        fireEvent.click(toggleBtn);

        // After click, still shows the same button text but now the pre is visible
        // And the pre formatting should contain the json
        expect(screen.getByText(/specific_resource_access/)).toBeInTheDocument();
    });

    it('handles resources exceeding CHIP_LIMIT', () => {
        // Recreate a result with 15 resources (CHIP_LIMIT is 12)
        const manyResourcesResult = {
            ...mockResult,
            resources: Array.from({ length: 15 }).map((_, i) => ({
                type: 'bucket', name: `bucket-${i}`, projectId: 'proj-1'
            }))
        };

        render(<ResultCard result={manyResourcesResult as QueryResult} index={0} />);

        // Should show the first 12
        expect(screen.getByText('bucket-0')).toBeInTheDocument();
        expect(screen.getByText('bucket-11')).toBeInTheDocument();

        // Should NOT show the 13th initially
        expect(screen.queryByText('bucket-12')).not.toBeInTheDocument();

        // Should have a button to show more (+3 more)
        const showMoreBtn = screen.getByText('+3 more');
        fireEvent.click(showMoreBtn);

        // Now it should show the 13th
        expect(screen.getByText('bucket-12')).toBeInTheDocument();

        // And have a "// collapse" button
        const showLessBtn = screen.getByText('// collapse');
        fireEvent.click(showLessBtn);

        // Back to not showing
        expect(screen.queryByText('bucket-12')).not.toBeInTheDocument();
    });
});
