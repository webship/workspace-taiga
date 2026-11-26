@site
Feature: The project of the site
  A first feature of a Taiga site of the Webship Workspace, placed by the testing setup: the site sends a visitor to its
  sign-in form, a member reads the sample project, and works a user story of its own, which goes after the scenario. It
  passes on a site built with --install --add-users --sample-content; add your own features beside it.

  # A visitor is sent to the sign-in form: the project is private, and the site's public sign-up is off.
  @js-off
  Scenario: A visitor is sent to the sign-in form
    Given I am not logged in
    When I open the backlog of the project "Webship site"
    Then I should be sent to the login form

  Scenario: A member reads the sample project
    Given I am a logged in user with the "member" user
    When I open the backlog of the project "Webship site"
    Then the backlog should show the user story "The usage line spells greeting as greting"
    And the sprint "Sprint 1" should show the user story "The greeting script says Helo instead of Hello"

  Scenario: A member works a user story of its own
    Given there is a user story "Webship test site" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the user story "Webship test site"
    And I add the comment "Checked on the test site" to the user story
    And I change the status of the user story to "In progress"
    Then the user story should show the comment "Checked on the test site" by "Member Test"
    And the user story should have the status "In progress"

  @js-off
  Scenario: An account the project does not have is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "Webship site"
