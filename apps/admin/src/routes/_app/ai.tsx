import { createFileRoute } from '@tanstack/react-router';

import { validateAiSearch } from '@/lib/search';
import { AiPage } from '@/pages/ai/ai.page';

export const Route = createFileRoute('/_app/ai')({
  validateSearch: validateAiSearch,
  component: AiPage,
});
