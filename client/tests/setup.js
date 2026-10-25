import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// How long findBy*/waitFor wait for something to appear. The default (1 s) is tight when several test
// files share one busy CPU (a laptop under load, a small CI runner). A wrong screen still fails: it just
// is given a fair chance to finish rendering first.
configure({ asyncUtilTimeout: 5000 });

afterEach(cleanup);
