import { MechIframeValidation } from '@/components/scene-renderers/mech-iframe-validation';

/**
 * Isolated engineering validation route. It stays inside the Zhiban route
 * domain so the legacy OpenMAIC access-code overlay does not intercept the
 * iframe interaction controls during local verification.
 */
export default function ZhibanMechIframeValidationPage() {
  return <MechIframeValidation />;
}
