from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for every request/response schema.

    The renderer's TypeScript types are camelCase (idiomatic JS); the ORM
    models and database columns are snake_case (idiomatic Python/SQL). This
    base makes the wire format camelCase in both directions without either
    side compromising its own convention — FastAPI serializes by alias by
    default, and `populate_by_name` lets these models still be constructed
    from snake_case ORM attributes via `from_attributes`.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)
