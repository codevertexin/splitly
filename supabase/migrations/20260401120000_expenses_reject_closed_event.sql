-- Block inserting or re-linking expenses to closed events (defense in depth for direct client inserts).
CREATE OR REPLACE FUNCTION public.expenses_reject_closed_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  st text;
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT e.status INTO st FROM public.events e WHERE e.id = NEW.event_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'Event not found for expense';
  END IF;
  IF st = 'closed' THEN
    RAISE EXCEPTION 'Cannot add or link expenses to a closed event';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_reject_closed_event_ins ON public.expenses;
CREATE TRIGGER expenses_reject_closed_event_ins
  BEFORE INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE PROCEDURE public.expenses_reject_closed_event();

DROP TRIGGER IF EXISTS expenses_reject_closed_event_upd ON public.expenses;
CREATE TRIGGER expenses_reject_closed_event_upd
  BEFORE UPDATE OF event_id ON public.expenses
  FOR EACH ROW
  WHEN (NEW.event_id IS DISTINCT FROM OLD.event_id)
  EXECUTE PROCEDURE public.expenses_reject_closed_event();
