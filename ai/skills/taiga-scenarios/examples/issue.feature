Feature: A user story worked by a member
  Scenario: A status, a comment, a tag and an assignee
    Given there is a user story "Webship test work" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the user story "Webship test work"
    And I change the status of the user story to "In progress"
    And I add the comment "Checked on the test site" to the user story
    And I add the tag "bug" to the user story
    And I assign the user story to "Member Test"
    Then the user story should have the status "In progress"
    And the user story should show the comment "Checked on the test site" by "Member Test"
    And the user story should have the tag "bug"
    And the user story should be assigned to "Member Test"
