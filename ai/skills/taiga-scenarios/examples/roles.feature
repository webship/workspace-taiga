Feature: Who may do what in a project
  Scenario: A reader reads a user story and changes nothing
    Given I am a logged in user with the "reader" user
    When I open the user story "The greeting script says Helo instead of Hello"
    Then I should not be able to change the user story
    And I should not be able to comment on the user story

  @js-off
  Scenario: An account the project does not have is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "Webship site"
