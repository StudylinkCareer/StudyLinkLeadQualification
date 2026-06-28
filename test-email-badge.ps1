# test-email-badge.ps1
# Run with:  .\test-email-badge.ps1
# Requires local dev running (start-dev-system.bat) so ports 3001 + 5000 are up.
# It will prompt for your password (so it is not stored in this file).

$email = "rhod5716@gmail.com"
$pw    = Read-Host "LM password"

$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "Logging in..."
$login = Invoke-RestMethod -Uri "http://localhost:3001/api/staff/login" -Method Post `
  -Body (@{ email = $email; password = $pw } | ConvertTo-Json) -ContentType "application/json" -WebSession $s
$login

# If you get "No advance badge token for this student at this event",
# pick a valid pair from pgAdmin and edit studentId + eventId below:
#   SELECT ea.student_unique_id, ea.event_id, s.full_name
#   FROM event_attendees ea JOIN students s ON s.student_id = ea.student_unique_id
#   WHERE ea.attendance_token IS NOT NULL ORDER BY ea.event_id DESC LIMIT 10;

$badge = @{
  studentId = "20260620-05"
  eventId  = 36
  email    = $email
  badgePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  badgeUrl = "https://example.com/badge/test"
} | ConvertTo-Json

Write-Host "Sending badge..."
Invoke-RestMethod -Uri "http://localhost:3001/api/event-console/email-badge" -Method Post `
  -Body $badge -ContentType "application/json" -WebSession $s
