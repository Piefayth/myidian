$(function(){

  var currentTracksList = [];

  /*Handlebars Templates*/

  var source = $("#user-profile-template")[0].innerHTML;
  var userProfileTemplate = Handlebars.compile(source);

  source = $("#loading-template")[0].innerHTML;
  var loadingTemplate = Handlebars.compile(source);

  source = $("#single-track-template")[0].innerHTML;
  var singleTrackTemplate = Handlebars.compile(source);

  source = $("#single-choice-template")[0].innerHTML;
  var singleChoiceTemplate = Handlebars.compile(source);

  /*After pageload and templating, check if the user is logged in.
    If not, display login button */

  $.get('checkloginstatus', function(data){
    if(data.login){
      $('#refresh').css('display', 'block');
      var result = userProfileTemplate(data);
      $("#user-profile").html(result);
      var result = loadingTemplate();
      for(var i = 0; i < 3; i++){
        $('#tracklist').append(result)
      }
      $("#refreshButton").on('click', function(event){
        $.ajax({
          url: 'refresh',
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(currentTracksList)
        });
        currentTracksList = [];
        newChoice();
      })
      newChoice();
    } else {
      $('#loginContainer').css('display', 'block');
    }
  })

  function newTrackItem(track){
    currentTracksList.push(track);
    var result = singleTrackTemplate(track);
    $("#tracklist").append(result);
    result = singleChoiceTemplate();
    $("#choicelist").append(result);
    $("#choicelist div button").last().on('click', function(event){
      currentTracksList = [];
      $("#tracklist").children().remove();
      $("#choicelist").children().remove();
      var result = loadingTemplate();
      for(var i = 0; i < 3; i++){
        $('#tracklist').append(result)
      }
      $.post('select', track, function(data){
        $.get('choice', function(tracks){
          $("#tracklist").children().remove();
          $("#choicelist div button").off('click');
          tracks.forEach(function(track){
            newTrackItem(track);
          })
        })
      })
    })
  }

  function newChoice(){

    $('#refreshButton').prop("disabled", true);
    $('#tracklist').children().remove();
    $('#choicelist').children().remove();
    var result = loadingTemplate();
    for(var i = 0; i < 3; i++){
      $('#tracklist').append(result)
    }
    $.get('choice', function(tracks){
      $('#tracklist').children().remove();
      if(tracks.err){
        newChoice();
      } else {
        tracks.forEach(function(track){
          newTrackItem(track);
        })
      }
      $('#refreshButton').prop("disabled", false);
    })
  }

})
