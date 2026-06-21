/**
 * Barrel for the admin native-UI primitives. Import destructive-confirm and the
 * form fields from here so admin screens have one stable seam:
 *   import { ConfirmDialog, LabeledTextInput, ModalSelect } from '../../components/admin';
 */
export { default as ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

export {
  LabeledTextInput,
  ModalSelect,
  HexColorField,
  DateField,
  TimeField,
  STAGE_COLOR_PRESETS,
  isValidDate,
  isValidTime,
} from './AdminFields';
export type {
  LabeledTextInputProps,
  ModalSelectProps,
  SelectOption,
  HexColorFieldProps,
  DateTimeFieldProps,
} from './AdminFields';
