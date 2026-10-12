"""Import every module's models so SQLAlchemy metadata (and Alembic) see the full schema."""

from app.core.models import (  # noqa: F401
    AuditEvent,
    IdempotencyRecord,
    IntegrationInbox,
    IntegrationMapping,
    Notification,
    NotificationPreference,
    OutboxEvent,
)
from app.db import Base  # noqa: F401
from app.modules.agile.models import Sprint, SprintScopeChange  # noqa: F401
from app.modules.identity.models import (  # noqa: F401
    Organization,
    ProjectMembership,
    Team,
    TeamMembership,
    User,
)
from app.modules.meetings.models import (  # noqa: F401
    AiActionProposal,
    Meeting,
    MeetingSummary,
    TranscriptSegment,
)
from app.modules.resources.models import (  # noqa: F401
    Allocation,
    CalendarException,
    Leave,
    ResourceProfile,
    WorkingCalendar,
)
from app.modules.service_desk.models import ServiceOffering, SlaEvent, SlaPolicy  # noqa: F401
from app.modules.time.models import TimeEntry, TimeEntryCorrection, TimesheetPeriod  # noqa: F401
from app.modules.work.models import (  # noqa: F401
    Comment,
    Project,
    Watcher,
    WorkItem,
    WorkItemHistory,
    WorkItemLink,
)
